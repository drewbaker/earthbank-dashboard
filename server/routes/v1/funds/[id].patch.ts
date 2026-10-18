import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFundManagerByIdentity, updateFundManagerColumns } from '#server/database/fund-managers.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { conflict } from '#server/utils/errors.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { clearResearchFromOldAddresses, queueFundRefresh } from '#server/utils/funds/refresh.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import { Prisma } from '#server/generated/prisma/client.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { IdentityCandidate, UpdateFundRequest } from '#shared/schemas/index.ts'
import { canonicalLinkedinUrl, organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Update a fund',
        description:
            "Edits the team's own fields: name, website, LinkedIn page, regional focus, stage, fit tags, notes and owner. Correcting the website or LinkedIn page retires research taken from the old one and refreshes the fund. Research findings aren't edited here.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateFundRequest' } } },
        },
        responses: {
            200: {
                description: 'The fund',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const fundManagerId = getRouterParam(event, 'id') ?? ''
    const fund = await requireFund({ fundManagerId })
    const body = await parseBody({ event, schema: UpdateFundRequest })
    await assertActiveUser({ userId: body.owner_id })

    const nameKey = body.name ? organizationNameKey({ name: body.name }) : undefined
    const domain = body.website_url === undefined ? undefined : websiteDomain({ url: body.website_url })
    if ((nameKey && nameKey !== fund.name_key) || (domain && domain !== fund.website_domain)) {
        const clash = await findFundManagerByIdentity({
            nameKey: nameKey ?? fund.name_key,
            websiteDomain: domain ?? null,
        })
        if (clash && clash.id !== fundManagerId) {
            throw conflict({ message: `${clash.name} already uses that name or website.` })
        }
    }
    await updateFundManagerColumns({
        fundManagerId,
        data: {
            name: body.name,
            name_key: nameKey,
            website_url: body.website_url,
            website_domain: domain,
            linkedin_url:
                body.linkedin_url === undefined
                    ? undefined
                    : body.linkedin_url && canonicalLinkedinUrl({ url: body.linkedin_url }),
            stage: body.stage,
            fit_tags: body.fit_tags,
            ...(body.focus_areas === undefined
                ? {}
                : body.focus_areas === null
                  ? { team_focus_areas: Prisma.DbNull }
                  : { team_focus_areas: [...new Set(body.focus_areas)], focus_areas: [...new Set(body.focus_areas)] }),
            notes: body.notes,
            owner_id: body.owner_id,
            identity_candidates: remainingIdentityCandidates({
                stored: fund.identity_candidates,
                hasWebsite: body.website_url !== undefined,
                hasLinkedin: body.linkedin_url !== undefined,
                isDismissed: body.dismiss_identity_candidates === true,
            }),
        },
    })
    // A corrected website or LinkedIn page: retire research taken from the old one, then refresh.
    const isNewWebsite =
        body.website_url !== undefined && websiteDomain({ url: body.website_url }) !== fund.website_domain
    const isNewLinkedin =
        body.linkedin_url !== undefined &&
        (body.linkedin_url ? canonicalLinkedinUrl({ url: body.linkedin_url }) : null) !== fund.linkedin_url
    if (isNewWebsite || isNewLinkedin) {
        await clearResearchFromOldAddresses({
            fundManagerId,
            oldWebsiteUrl: isNewWebsite ? fund.website_url : null,
            oldLinkedinUrl: isNewLinkedin ? fund.linkedin_url : null,
        })
        if (!fund.archived_at) {
            await queueFundRefresh({ fundManagerId, now: new Date() })
        }
    }
    // Back to research's regional focus once the team clears theirs.
    if (body.focus_areas === null) {
        await refreshFundResearchValues({ fundManagerId })
    }
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.updated',
        entityType: 'fund',
        entityId: fundManagerId,
        changes: { fields: Object.keys(body), refreshed: isNewWebsite || isNewLinkedin },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})

/**
 * The identity candidates still waiting once this edit lands: setting the website or LinkedIn page
 * answers that question, and "None of these" drops them all.
 *
 * Helper function: only this route uses it.
 *
 * @param input.stored - The stored candidates (JSON).
 * @param input.hasWebsite - Whether this edit sets the website.
 * @param input.hasLinkedin - Whether this edit sets the LinkedIn page.
 * @param input.isDismissed - Whether the person chose "None of these".
 * @returns The candidates to keep, or undefined to leave the column alone.
 */
function remainingIdentityCandidates({
    stored,
    hasWebsite,
    hasLinkedin,
    isDismissed,
}: {
    stored: unknown
    hasWebsite: boolean
    hasLinkedin: boolean
    isDismissed: boolean
}) {
    if (isDismissed) {
        return []
    }
    if (!hasWebsite && !hasLinkedin) {
        return undefined
    }
    const parsed = IdentityCandidate.array().safeParse(stored)
    const candidates = parsed.success ? parsed.data : []
    return candidates.filter(
        candidate => !(candidate.kind === 'website' && hasWebsite) && !(candidate.kind === 'linkedin' && hasLinkedin),
    )
}
