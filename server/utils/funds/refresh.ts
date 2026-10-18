import { setFundResearchStatus } from '#server/database/fund-managers.ts'
import {
    deleteFundPeople,
    listFundFindings,
    listFundPeople,
    supersedeFundFindings,
} from '#server/database/fund-research.ts'
import { normalizeUrl } from '#server/utils/funds/verify-finding.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import { enqueueFundResearch } from '#server/utils/jobs/enqueue.ts'
import { canonicalLinkedinUrl, websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * Queue a full refresh of a fund's research, ahead of spidered funds. Research only fills and updates
 * research findings; the team's own fields (name, website, LinkedIn page, stage, tags, notes, owner)
 * and people's diligence answers are never changed by it, and values someone rejected stay rejected.
 *
 * @param input.fundManagerId - The fund.
 * @param input.now - Current time.
 * @returns Resolves once queued.
 */
export async function queueFundRefresh({ fundManagerId, now }: { fundManagerId: string; now: Date }) {
    await enqueueFundResearch({ fundManagerId, isPriority: true })
    await setFundResearchStatus({ fundManagerId, status: 'queued', now })
}

/**
 * After someone corrects a fund's website or LinkedIn page, retire what research took from the old
 * one: findings whose every source is on the old website or the old LinkedIn page (including the
 * company record looked up by it) are superseded, the old website/LinkedIn findings too, and people
 * found only on the old website are removed. A refresh then researches the right organization.
 *
 * @param input.fundManagerId - The fund.
 * @param input.oldWebsiteUrl - The website before the change, or null when unchanged.
 * @param input.oldLinkedinUrl - The LinkedIn page before the change, or null when unchanged.
 * @returns How many findings and people were retired.
 */
export async function clearResearchFromOldAddresses({
    fundManagerId,
    oldWebsiteUrl,
    oldLinkedinUrl,
}: {
    fundManagerId: string
    oldWebsiteUrl: string | null
    oldLinkedinUrl: string | null
}) {
    const oldDomain = websiteDomain({ url: oldWebsiteUrl })
    const oldLinkedin = oldLinkedinUrl ? normalizeUrl({ url: canonicalLinkedinUrl({ url: oldLinkedinUrl }) }) : null
    const isFromOldAddress = (url: string) => {
        const host = websiteDomain({ url })
        const onOldSite = oldDomain !== null && host !== null && (host === oldDomain || host.endsWith(`.${oldDomain}`))
        const onOldLinkedin =
            oldLinkedin !== null && normalizeUrl({ url: canonicalLinkedinUrl({ url }) }) === oldLinkedin
        return onOldSite || onOldLinkedin
    }
    const findings = await listFundFindings({ fundManagerId })
    const staleFindingIds = findings
        .filter(finding => {
            const isAddressField =
                (oldDomain !== null && finding.field === 'website_url') ||
                (oldLinkedin !== null && finding.field === 'linkedin_url')
            const sources = finding.sources.map(link => link.source.url)
            return isAddressField || (sources.length > 0 && sources.every(isFromOldAddress))
        })
        .map(finding => finding.id)
    const people = await listFundPeople({ fundManagerId })
    const stalePersonIds = people
        .filter(person => person.sources.length > 0 && person.sources.every(link => isFromOldAddress(link.source.url)))
        .map(person => person.id)
    if (staleFindingIds.length > 0) {
        await supersedeFundFindings({ findingIds: staleFindingIds })
    }
    if (stalePersonIds.length > 0) {
        await deleteFundPeople({ personIds: stalePersonIds })
    }
    await refreshFundResearchValues({ fundManagerId })
    return { findings: staleFindingIds.length, people: stalePersonIds.length }
}
