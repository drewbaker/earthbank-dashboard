import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '#server/utils/config.ts'

// Fixed key for local development only, so a fresh checkout works without setup.
// Production refuses to start encryption without APP_ENCRYPTION_KEY.
const DEVELOPMENT_KEY = createHash('sha256').update('earthbank-dashboard-development-key').digest()

/**
 * The 32-byte AES key from `APP_ENCRYPTION_KEY` (base64).
 *
 * @returns The key bytes.
 * @throws Error when the key is missing in production or isn't 32 bytes.
 */
function encryptionKey() {
    const encoded = config.appEncryptionKey
    if (!encoded) {
        if (config.isProduction) {
            throw new Error('APP_ENCRYPTION_KEY is required in production')
        }
        return DEVELOPMENT_KEY
    }
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32) {
        throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)')
    }
    return key
}

/**
 * Encrypt a secret with AES-256-GCM. The output carries its own IV and auth tag.
 *
 * @param input.plaintext - The secret to encrypt.
 * @returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
export function encryptSecret({ plaintext }: { plaintext: string }) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ['v1', iv, tag, ciphertext]
        .map(part => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.')
}

/**
 * Decrypt a value produced by `encryptSecret`.
 *
 * @param input.encrypted - The `v1.…` string.
 * @returns The plaintext, or null when the value is malformed or was tampered with.
 */
export function decryptSecret({ encrypted }: { encrypted: string }) {
    const [version, iv, tag, ciphertext] = encrypted.split('.')
    if (version !== 'v1' || !iv || !tag || !ciphertext) {
        return null
    }
    try {
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
        decipher.setAuthTag(Buffer.from(tag, 'base64url'))
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
        return null
    }
}

/**
 * Generate an opaque random token (~256 bits).
 *
 * @returns A base64url token.
 */
export function newOpaqueToken() {
    return randomBytes(32).toString('base64url')
}

/**
 * Hash a token for storage; only the hash ever touches the database.
 *
 * @param input.token - The opaque token.
 * @returns Hex SHA-256 of the token.
 */
export function hashToken({ token }: { token: string }) {
    return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two secrets without leaking timing information.
 *
 * @param input.expected - The known value.
 * @param input.actual - The value supplied by the caller.
 * @returns True when they match exactly.
 */
export function secretsMatch({ expected, actual }: { expected: string; actual: string }) {
    const expectedBytes = Buffer.from(expected)
    const actualBytes = Buffer.from(actual)
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
