// Covers pacing Gmail calls and riding out Google's per-minute quota errors instead of failing a sync.
import { describe, expect, it } from 'vitest'
import { createGmailThrottle, isGmailRateLimit } from '#server/utils/mail/gmail.ts'

/**
 * A fake clock whose waits move time forward.
 *
 * @returns The clock, its wait function, and the waits made.
 */
function fakeClock() {
    let time = 0
    const waits: number[] = []
    return {
        now: () => time,
        wait: async (milliseconds: number) => {
            waits.push(milliseconds)
            time += milliseconds
        },
        waits,
    }
}

describe('createGmailThrottle', () => {
    it('spaces calls out', async () => {
        const clock = fakeClock()
        const throttle = createGmailThrottle({ minIntervalMs: 100, wait: clock.wait, now: clock.now })
        await throttle.run(async () => 1)
        await throttle.run(async () => 2)
        await throttle.run(async () => 3)
        expect(clock.waits).toEqual([100, 100])
    })

    it('waits and retries when Gmail reports a quota limit', async () => {
        const clock = fakeClock()
        const throttle = createGmailThrottle({
            minIntervalMs: 0,
            retryDelaysMs: [15_000, 30_000],
            wait: clock.wait,
            now: clock.now,
        })
        let attempts = 0
        const result = await throttle.run(async () => {
            attempts++
            if (attempts < 3) {
                throw Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost'"), { status: 429 })
            }
            return 'ok'
        })
        expect(result).toBe('ok')
        expect(clock.waits).toEqual([15_000, 30_000])
    })

    it('gives up after the last retry, and never retries other errors', async () => {
        const clock = fakeClock()
        const throttle = createGmailThrottle({ minIntervalMs: 0, retryDelaysMs: [1], wait: clock.wait, now: clock.now })
        const quota = Object.assign(new Error('Rate Limit Exceeded'), { status: 429 })
        await expect(throttle.run(async () => Promise.reject(quota))).rejects.toBe(quota)
        const notFound = Object.assign(new Error('Not Found'), { status: 404 })
        let calls = 0
        await expect(
            throttle.run(async () => {
                calls++
                throw notFound
            }),
        ).rejects.toBe(notFound)
        expect(calls).toBe(1)
    })
})

describe('isGmailRateLimit', () => {
    it('recognises quota and rate errors only', () => {
        expect(isGmailRateLimit({ error: Object.assign(new Error('x'), { status: 429 }) })).toBe(true)
        expect(isGmailRateLimit({ error: Object.assign(new Error('User Rate Limit Exceeded'), { code: 403 }) })).toBe(
            true,
        )
        expect(isGmailRateLimit({ error: Object.assign(new Error('Insufficient Permission'), { code: 403 }) })).toBe(
            false,
        )
        expect(isGmailRateLimit({ error: new Error('invalid_grant') })).toBe(false)
    })
})

describe('createGmailThrottle pacing', () => {
    it('slows down after a rate limit', async () => {
        const clock = fakeClock()
        const throttle = createGmailThrottle({
            minIntervalMs: 100,
            retryDelaysMs: [1000],
            wait: clock.wait,
            now: clock.now,
        })
        let attempts = 0
        await throttle.run(async () => {
            attempts++
            if (attempts === 1) {
                throw Object.assign(new Error('Rate Limit Exceeded'), { status: 429 })
            }
        })
        clock.waits.length = 0
        await throttle.run(async () => undefined)
        await throttle.run(async () => undefined)
        // Back off once more after the retry, then twice the original spacing.
        expect(clock.waits.at(-1)).toBe(200)
    })
})
