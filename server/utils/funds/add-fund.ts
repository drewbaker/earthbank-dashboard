import { createFundManagerRow, findFundManagerByIdentity, isPriorityOrigin } from '#server/database/fund-managers.ts'
import { linkOrganizationToFund } from '#server/database/fund-research.ts'
import { enqueueFundResearch } from '#server/utils/jobs/enqueue.ts'
import type { FundOrigin } from '#shared/constants/funds.ts'
import {
    canonicalLinkedinUrl,
    organizationNameKey,
    tidyOrganizationName,
    websiteDomain,
} from '#shared/funds/organization-names.ts'

/**
 * Put a lender on the list (unless it's already there) and queue its research.
 *
 * Funds are matched by normalized name or website domain, so "Iungo Capital Ltd" and
 * iungocapital.com don't create a second profile. Funds the spider finds go in as pending and aren't
 * researched until someone approves them (many turn out to be local lenders outside Earth Bank's
 * focus); funds people add or the seed list holds are approved and queued at once.
 *
 * @param input.name - Display name; tidied (legal forms dropped, all-caps names in title case).
 * @param input.isNameChecked - The name was given by a person or tidied by the AI name check already.
 * @param input.websiteUrl - Website, if known.
 * @param input.linkedinUrl - LinkedIn company page, if known.
 * @param input.discoveryContext - How the fund came up or a region hint, used to find the right website.
 * @param input.origin - How it got onto the list.
 * @param input.discoveredFromId - The fund whose research turned it up, if any.
 * @param input.addedById - The team member who added it by hand, if any (recorded as its approver).
 * @param input.screening - The spider's AI screen: its reason, and whether the lender fits Earth Bank
 *   (when not, it goes in archived so the team can review it later).
 * @param input.now - Current time.
 * @returns The fund row and whether it was newly created.
 */
export async function addFund({
    name,
    websiteUrl,
    linkedinUrl = null,
    discoveryContext = null,
    origin,
    discoveredFromId = null,
    addedById = null,
    screening = null,
    isNameChecked = false,
    now,
}: {
    name: string
    websiteUrl: string | null
    linkedinUrl?: string | null
    discoveryContext?: string | null
    origin: FundOrigin
    discoveredFromId?: string | null
    addedById?: string | null
    screening?: { note: string | null; fitsEarthBank: boolean } | null
    isNameChecked?: boolean
    now: Date
}) {
    const nameKey = organizationNameKey({ name })
    const domain = websiteDomain({ url: websiteUrl })
    const existing = await findFundManagerByIdentity({ nameKey, websiteDomain: domain })
    if (existing) {
        return { fund: existing, isNew: false }
    }
    const fund = await createFundManagerRow({
        name: tidyOrganizationName({ name }),
        nameKey,
        websiteUrl: domain ? websiteUrl : null,
        websiteDomain: domain,
        linkedinUrl: linkedinUrl ? canonicalLinkedinUrl({ url: linkedinUrl }) : null,
        discoveryContext: discoveryContext?.slice(0, 500) ?? null,
        origin,
        discoveredFromId,
        approvalStatus: needsApproval({ origin }) ? 'pending' : 'approved',
        approvedById: addedById,
        screening,
        // Names people type are taken as written (only tidied); others wait for the AI name check.
        isNameChecked: isNameChecked || addedById !== null,
        now,
    })
    await linkOrganizationToFund({ nameKey, fundManagerId: fund.id })
    if (fund.approval_status === 'approved') {
        await enqueueFundResearch({ fundManagerId: fund.id, isPriority: isPriorityOrigin({ origin }) })
    }
    return { fund, isNew: true }
}

/**
 * Whether a fund that got onto the list this way waits for someone's approval before research.
 *
 * @param input.origin - How it got onto the list.
 * @returns True for funds the spider found.
 */
export function needsApproval({ origin }: { origin: FundOrigin }) {
    return origin.startsWith('spider_')
}
