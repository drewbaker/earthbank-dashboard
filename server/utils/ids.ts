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
    knowledgeSource: 'ksr',
    knowledgeDocument: 'kdc',
    plannedExpense: 'pex',
    shareLink: 'shl',
} as const

export type IdKind = keyof typeof ID_PREFIXES

const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

// Monotonic within a process: ids made in the same millisecond reuse the previous random part plus
// one, so ids always sort in creation order (the change log and cursors rely on it).
let lastTime = -1
let lastRandom: number[] = []

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
    if (now === lastTime) {
        incrementRandom({ digits: lastRandom })
    } else {
        lastTime = now
        lastRandom = randomDigits()
    }
    return `${ID_PREFIXES[kind]}_${encodeTime({ time: lastTime })}${lastRandom.map(digit => CROCKFORD_ALPHABET[digit]).join('')}`
}

/**
 * Add one to a base-32 number held as digits (most significant first), in place.
 *
 * @param input.digits - 16 base-32 digits.
 * @returns Nothing; `digits` is updated.
 */
function incrementRandom({ digits }: { digits: number[] }) {
    for (let index = digits.length - 1; index >= 0; index--) {
        if (digits[index]! < 31) {
            digits[index]!++
            return
        }
        digits[index] = 0
    }
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
 * 80 random bits as 16 base-32 digits.
 *
 * @returns Digits 0–31, most significant first.
 */
function randomDigits() {
    // Plain numbers rather than BigInt: Nitro's esbuild target doesn't allow BigInt literals.
    const digits: number[] = []
    let buffer = 0
    let bufferedBits = 0
    for (const byte of randomBytes(10)) {
        buffer = (buffer << 8) | byte
        bufferedBits += 8
        while (bufferedBits >= 5) {
            bufferedBits -= 5
            digits.push((buffer >> bufferedBits) & 31)
        }
        buffer &= (1 << bufferedBits) - 1
    }
    return digits
}
