import type { z } from 'zod'
import { ErrorResponse } from '#shared/schemas/common.ts'
import { CurrentUser, User, UserList } from '#shared/schemas/users.ts'

export * from '#shared/schemas/common.ts'
export * from '#shared/schemas/users.ts'

// Every schema referenced as #/components/schemas/<Name> in route meta. The OpenAPI plugin turns
// these into JSON Schema, so route files can stay static literals.
export const openapiSchemas: Record<string, z.ZodType> = {
    ErrorResponse,
    User,
    UserList,
    CurrentUser,
}
