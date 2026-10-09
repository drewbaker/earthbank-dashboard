import { randomBytes } from 'node:crypto'

// Every kind of record and its id prefix. Adding a model means adding it here first.
export const ID_PREFIXES = {
    user: 'usr',
    session: 'ses',
    auditLog: 'aud',
    funder: 'fnd',
    contact: 'con',
    opportunity: 'opp',
    goal: 'gol',
    milestone: 'mst',
    task: 'tsk',
    comment: 'cmt',
    attachment: 'att',
    bankAccount: 'bac',
    balanceSnapshot: 'bal',
    bankTransaction: 'btx',
    scenario: 'scn',
    mailboxConnection: 'mbx',
    emailEvidence: 'eml',
    changeEvent: 'chg',
    inboundAddress: 'iad',
} as const

export type IdKind = keyof typeof ID_PREFIXES

const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * Generate a prefixed, time-sortable id (ULID layout: 48-bit millisecond time + 80 random bits).
 *
 * Sorting ids sorts by creation time, which keeps cursor pagination cheap.
 *
 * @param input.kind - Record kind; picks the prefix from `ID_PREFIXES`.
 * @param input.now - Timestamp in milliseconds; defaults to the current time (overridable for tests).
 * @returns An id such as `usr_01k6x3…` (26 base32 characters after the prefix).
 */
export function newId({ kind, now = Date.now() }: { kind: IdKind; now?: number }) {
    return `${ID_PREFIXES[kind]}_${encodeTime({ time: now })}${encodeRandom()}`
}

/**
 * Encode a millisecond timestamp as 10 Crockford base32 characters.
 *
 * @param input.time - Milliseconds since the epoch.
 * @returns The encoded time, most significant character first.
 */
function encodeTime({ time }: { time: number }) {
    let remaining = time
    let encoded = ''
    for (let index = 0; index < 10; index++) {
        encoded = CROCKFORD_ALPHABET[remaining % 32] + encoded
        remaining = Math.floor(remaining / 32)
    }
    return encoded
}

/**
 * Encode 80 random bits as 16 Crockford base32 characters.
 *
 * @returns The random part of an id.
 */
function encodeRandom() {
    // Plain numbers rather than BigInt: Nitro's esbuild target doesn't allow BigInt literals.
    let encoded = ''
    let buffer = 0
    let bufferedBits = 0
    for (const byte of randomBytes(10)) {
        buffer = (buffer << 8) | byte
        bufferedBits += 8
        while (bufferedBits >= 5) {
            bufferedBits -= 5
            encoded += CROCKFORD_ALPHABET[(buffer >> bufferedBits) & 31]
        }
        buffer &= (1 << bufferedBits) - 1
    }
    return encoded
}
