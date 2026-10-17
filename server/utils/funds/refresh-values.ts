import {
    findFundManager,
    findFundManagerByDomain,
    storeFundResearchValues,
    updateFundManagerColumns,
} from '#server/database/fund-managers.ts'
import { listFundDiligenceAnswers, listFundFindings, readFundTeamCoverage } from '#server/database/fund-research.ts'
import { deriveFundResearchValues } from '#server/utils/funds/research-values.ts'
import type { FundResearchField } from '#shared/constants/funds.ts'
import { diligenceCompleteness } from '#shared/funds/completeness.ts'
import { websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * Recompute and store a fund's sortable research values and completeness from its current data.
 *
 * Runs after research, after a finding is rejected or restored, and after a diligence answer changes.
 * A fund added without a website takes the one research verified (unless another fund has that domain).
 *
 * @param input.fundManagerId - The fund.
 * @returns The stored fund row.
 */
export async function refreshFundResearchValues({ fundManagerId }: { fundManagerId: string }) {
    const [findings, coverage, answers] = await Promise.all([
        listFundFindings({ fundManagerId }),
        readFundTeamCoverage({ fundManagerId }),
        listFundDiligenceAnswers({ fundManagerId }),
    ])
    const values = deriveFundResearchValues({
        findings: findings.map(finding => ({
            field: finding.field as FundResearchField,
            value: finding.value,
            created_at: finding.created_at,
        })),
        hasPrincipals: coverage.hasPrincipals,
        hasWorkHistory: coverage.hasWorkHistory,
    })
    await adoptResearchedWebsite({
        fundManagerId,
        websiteUrl: findings.find(finding => finding.field === 'website_url')?.value as { url?: string } | undefined,
    })
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
