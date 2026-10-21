import {
    findFundManager,
    findFundManagerByDomain,
    listFundsWithoutFitSignals,
    storeFundResearchValues,
    updateFundManagerColumns,
} from '#server/database/fund-managers.ts'
import { listFundDiligenceAnswers, listFundFindings, readFundTeamCoverage } from '#server/database/fund-research.ts'
import { deriveFundResearchValues } from '#server/utils/funds/research-values.ts'
import type { FundResearchField } from '#shared/constants/funds.ts'
import { diligenceCompleteness } from '#shared/funds/completeness.ts'
import { canonicalLinkedinUrl, websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * Work out the fit signals of funds researched before the signals existed (runs at boot; each fund
 * once, since refreshing stores them).
 *
 * @returns How many funds were refreshed.
 */
export async function fillMissingFitSignals() {
    const funds = await listFundsWithoutFitSignals()
    for (const fund of funds) {
        await refreshFundResearchValues({ fundManagerId: fund.id })
    }
    return funds.length
}

/**
 * Recompute and store a fund's sortable research values and completeness from its current data.
 *
 * Runs after research, after a finding is rejected or restored, and after a diligence answer changes.
 * A fund added without a website takes the one research verified (unless another fund has that domain).
 * When the team set the regional focus by hand, theirs is kept over what research found.
 *
 * @param input.fundManagerId - The fund.
 * @returns The stored fund row.
 */
export async function refreshFundResearchValues({ fundManagerId }: { fundManagerId: string }) {
    const [findings, coverage, answers, row] = await Promise.all([
        listFundFindings({ fundManagerId }),
        readFundTeamCoverage({ fundManagerId }),
        listFundDiligenceAnswers({ fundManagerId }),
        findFundManager({ fundManagerId }),
    ])
    const values = deriveFundResearchValues({
        lastEmailOn: row?.last_email_on ?? null,
        activityConfirmedAt: row?.activity_confirmed_at ?? null,
        findings: findings.map(finding => ({
            field: finding.field as FundResearchField,
            value: finding.value,
            created_at: finding.created_at,
        })),
        hasPrincipals: coverage.hasPrincipals,
        hasWorkHistory: coverage.hasWorkHistory,
    })
    await adoptResearchedLinkedin({
        fundManagerId,
        linkedinUrl: findings.find(finding => finding.field === 'linkedin_url')?.value as { url?: string } | undefined,
    })
    await adoptResearchedWebsite({
        fundManagerId,
        websiteUrl: findings.find(finding => finding.field === 'website_url')?.value as { url?: string } | undefined,
    })
    const fund = await findFundManager({ fundManagerId })
    const teamFocus = Array.isArray(fund?.team_focus_areas) ? (fund.team_focus_areas as string[]) : null
    if (teamFocus) {
        values.focus_areas = teamFocus
    }
    return storeFundResearchValues({
        fundManagerId,
        values,
        diligenceCompleteness: diligenceCompleteness({ answeredCount: answers.length }),
    })
}

/**
 * Set the fund's website from a verified website finding when it has none yet.
 *
 * @param input.fundManagerId - The fund.
 * @param input.websiteUrl - The website finding's value, if any.
 * @returns Nothing.
 */
async function adoptResearchedWebsite({
    fundManagerId,
    websiteUrl,
}: {
    fundManagerId: string
    websiteUrl: { url?: string } | undefined
}) {
    const url = websiteUrl?.url
    const domain = websiteDomain({ url })
    if (!url || !domain) {
        return
    }
    const fund = await findFundManager({ fundManagerId })
    if (!fund || fund.website_url) {
        return
    }
    const owner = await findFundManagerByDomain({ websiteDomain: domain })
    if (owner && owner.id !== fundManagerId) {
        return
    }
    await updateFundManagerColumns({ fundManagerId, data: { website_url: url, website_domain: domain } })
}

/**
 * Set the fund's LinkedIn page from a verified LinkedIn finding when it has none yet.
 *
 * @param input.fundManagerId - The fund.
 * @param input.linkedinUrl - The LinkedIn finding's value, if any.
 * @returns Nothing.
 */
async function adoptResearchedLinkedin({
    fundManagerId,
    linkedinUrl,
}: {
    fundManagerId: string
    linkedinUrl: { url?: string } | undefined
}) {
    if (!linkedinUrl?.url) {
        return
    }
    const fund = await findFundManager({ fundManagerId })
    if (fund && !fund.linkedin_url) {
        await updateFundManagerColumns({
            fundManagerId,
            data: { linkedin_url: canonicalLinkedinUrl({ url: linkedinUrl.url }) },
        })
    }
}
