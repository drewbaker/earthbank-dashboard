import { findUser } from '#server/database/users.ts'
import { badRequest } from '#server/utils/errors.ts'

/**
 * Make sure an owner/assignee id points at an active team member.
 *
 * @param input.userId - The id to check; null and undefined pass (no owner).
 * @returns Resolves when valid.
 * @throws ApiError 400 `invalid_user` when the user doesn't exist or is deactivated.
 */
export async function assertActiveUser({ userId }: { userId: string | null | undefined }) {
    if (!userId) {
        return
    }
    const user = await findUser({ userId })
    if (!user || user.deactivated_at) {
        throw badRequest({ message: 'Choose an active team member.', code: 'invalid_user' })
    }
}
