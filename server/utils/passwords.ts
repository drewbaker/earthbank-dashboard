import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>

// Share-link passwords are the only passwords the app keeps (sign-in is Google-only). scrypt is in
// Node itself, so no native hashing package is needed.
const KEY_LENGTH = 32

/**
 * Hash a password for storage.
 *
 * @param input.password - The password.
 * @returns `scrypt$<salt>$<hash>`, both base64url.
 */
export async function hashPassword({ password }: { password: string }) {
    const salt = randomBytes(16)
    const hash = await scryptAsync(password, salt, KEY_LENGTH)
    return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

/**
 * Check a password against a stored hash, in constant time.
 *
 * @param input.password - The password someone typed.
 * @param input.passwordHash - The stored `hashPassword` result.
 * @returns True when it matches.
 */
export async function verifyPassword({ password, passwordHash }: { password: string; passwordHash: string }) {
    const [scheme, saltText, hashText] = passwordHash.split('$')
    if (scheme !== 'scrypt' || !saltText || !hashText) {
        return false
    }
    const expected = Buffer.from(hashText, 'base64url')
    const actual = await scryptAsync(password, Buffer.from(saltText, 'base64url'), expected.length)
    return timingSafeEqual(expected, actual)
}
