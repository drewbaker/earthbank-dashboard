import { z } from 'zod'
import { OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import { IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'
import { Goal } from '#shared/schemas/goals.ts'

/** A funder-facing link, as the team sees it in Settings → Sharing. */
export const ShareLink = z.object({
    id: z.string(),
    label: z.string(),
    url: z.string(),
    /** Null for links made before passwords were kept. */
    password: z.string().nullable(),
    show_next_steps: z.boolean(),
    created_by: UserSummary.nullable(),
    last_viewed_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
})
export type ShareLink = z.infer<typeof ShareLink>

export const ShareLinkList = listOf(ShareLink)
export type ShareLinkList = z.infer<typeof ShareLinkList>

export const CreateShareLinkRequest = z.object({
    label: z.string().trim().min(1, 'Give the link a name.').max(120),
    password: z.string().min(8, 'Use at least 8 characters.').max(200),
    show_next_steps: z.boolean().default(true),
})
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequest>

export const UnlockShareLinkRequest = z.object({ password: z.string().min(1, 'Enter the password.').max(200) })
export type UnlockShareLinkRequest = z.infer<typeof UnlockShareLinkRequest>

/** One ask as funders see it: no ids, emails, notes, owners or AI reasoning. */
export const SharedAsk = z.object({
    organization: z.string(),
    /** Names only, never email addresses. */
    contacts: z.array(z.string()),
    /** Countries, regions or "Global", as names. */
    geo_focus: z.array(z.string()),
    amount_cents: z.number().int().nullable(),
    stage: z.enum(OPPORTUNITY_STAGES),
    /** A short version of the next step, or null when the link hides next steps. */
    next_step: z.string().nullable(),
})
export type SharedAsk = z.infer<typeof SharedAsk>

export const SharedPipeline = z.object({
    title: z.string(),
    updated_at: IsoDateTime,
    design_grants: z.array(SharedAsk),
    lending_capital: z.array(SharedAsk),
    /** The goal stats boxes, as on the Pipeline page (notes left out). */
    design_grant_goals: z.array(Goal),
    lending_capital_goals: z.array(Goal),
})
export type SharedPipeline = z.infer<typeof SharedPipeline>
