import { createFundManagerRow, findFundManagerByIdentity, isPriorityOrigin } from '#server/database/fund-managers.ts'
import { linkOrganizationToFund } from '#server/database/fund-research.ts'
import { enqueueFundResearch } from '#server/utils/jobs/enqueue.ts'
import type { FundOrigin } from '#shared/constants/funds.ts'
import { canonicalLinkedinUrl, organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * Put a lender on the list (unless it's already there) and queue its research.
 *
 * Funds are matched by normalized name or website domain, so "Iungo Capital Ltd" and
 * iungocapital.com don't create a second profile.
 *
 * @param input.name - Display name.
 * @param input.websiteUrl - Website, if known.
 * @param input.linkedinUrl - LinkedIn company page, if known.
 * @param input.origin - How it got onto the list.
 * @param input.discoveredFromId - The fund whose research turned it up, if any.
 * @param input.now - Current time.
 * @returns The fund row and whether it was newly created.
 */
export async function addFund({
    name,
    websiteUrl,
    linkedinUrl = null,
    origin,
    discoveredFromId = null,
    now,
}: {
    name: string
    websiteUrl: string | null
    linkedinUrl?: string | null
    origin: FundOrigin
    discoveredFromId?: string | null
    now: Date
}) {
    const nameKey = organizationNameKey({ name })
    const domain = websiteDomain({ url: websiteUrl })
    const existing = await findFundManagerByIdentity({ nameKey, websiteDomain: domain })
    if (existing) {
        return { fund: existing, isNew: false }
    }
    const fund = await createFundManagerRow({
        name: name.trim(),
        nameKey,
        websiteUrl: domain ? websiteUrl : null,
        websiteDomain: domain,
        linkedinUrl: linkedinUrl ? canonicalLinkedinUrl({ url: linkedinUrl }) : null,
        origin,
        discoveredFromId,
        now,
    })
    await linkOrganizationToFund({ nameKey, fundManagerId: fund.id })
    await enqueueFundResearch({ fundManagerId: fund.id, isPriority: isPriorityOrigin({ origin }) })
    return { fund, isNew: true }
}
