import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'

/**
 * Read one setting's raw JSON value.
 *
 * @param input.key - Setting key, e.g. `stage_probabilities`.
 * @returns The stored JSON, or null when it was never set.
 */
export async function readSettingValue({ key }: { key: string }) {
    const setting = await db().setting.findUnique({ where: { key } })
    return setting?.value ?? null
}

/**
 * Store one setting's JSON value.
 *
 * @param input.key - Setting key.
 * @param input.value - JSON to store (already validated by the caller).
 * @returns The setting row.
 */
export function writeSettingValue({ key, value }: { key: string; value: Prisma.InputJsonValue }) {
    return db().setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}
