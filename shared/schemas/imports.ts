import { z } from 'zod'
import { GOAL_TYPES, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'

export const PipelineImportPreview = z.object({
    funders: z.array(
        z.object({
            name: z.string(),
            tier: z.string().nullable(),
            contact_count: z.number().int(),
            opportunities: z.array(
                z.object({
                    goal_type: z.enum(GOAL_TYPES),
                    stage: z.enum(OPPORTUNITY_STAGES),
                    amount_cents: z.number().int().nullable(),
                }),
            ),
        }),
    ),
    warnings: z.array(z.string()),
})
export type PipelineImportPreview = z.infer<typeof PipelineImportPreview>

export const PipelineImportResult = z.object({
    funders_created: z.number().int(),
    funders_updated: z.number().int(),
    funders_unchanged: z.number().int(),
    contacts_added: z.number().int(),
    opportunities_created: z.number().int(),
    opportunities_updated: z.number().int(),
    skipped: z.array(z.string()),
    warnings: z.array(z.string()),
})
export type PipelineImportResult = z.infer<typeof PipelineImportResult>

export const PipelineImportResponse = z.union([PipelineImportPreview, PipelineImportResult])
export type PipelineImportResponse = z.infer<typeof PipelineImportResponse>
