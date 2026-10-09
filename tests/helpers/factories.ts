/**
 * Create an active team member directly in the test database.
 *
 * @param input.name - Display name.
 * @param input.email - Workspace email.
 * @returns The user row.
 */
export async function createTestUser({ name = 'Test User', email }: { name?: string; email: string }) {
    const { upsertGoogleUser } = await import('#server/database/users.ts')
    return upsertGoogleUser({ googleSub: `test-${email}`, email, name, avatarUrl: null, signedInAt: new Date() })
}
