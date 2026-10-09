import { z } from 'zod'
import { IsoDateTime } from '#shared/schemas/common.ts'

export const Contact = z.object({
    id: z.string(),
    funder_id: z.string(),
    name: z.string(),
    title: z.string().nullable(),
    email: z.string().nullable(),
    notes: z.string().nullable(),
    created_at: IsoDateTime,
})
export type Contact = z.infer<typeof Contact>

export const CreateContactRequest = z.object({
    name: z.string().trim().min(1, 'Name is required.').max(200),
    title: z.string().trim().max(200).nullish(),
    // Empty form fields arrive as '' and mean "no email".
    email: z.preprocess(
        value => (value === '' ? null : value),
        z.string().trim().toLowerCase().pipe(z.email('Enter a valid email.')).nullish(),
    ),
    notes: z.string().trim().max(5000).nullish(),
})
export type CreateContactRequest = z.infer<typeof CreateContactRequest>

export const UpdateContactRequest = CreateContactRequest.partial()
export type UpdateContactRequest = z.infer<typeof UpdateContactRequest>
