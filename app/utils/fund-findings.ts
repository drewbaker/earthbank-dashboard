import type { FundResearchField, FundSector, LoanType } from '#shared/constants/funds.ts'
import {
    CURRENCY_BASIS_LABELS,
    FUND_SECTOR_LABELS,
    LENDER_ARCHETYPE_LABELS,
    LENDING_CHANNEL_LABELS,
    LOAN_TYPE_LABELS,
    RISK_SHARING_KIND_LABELS,
    UNDERWRITING_APPROACH_LABELS,
} from '#shared/constants/funds.ts'
import type { FundFindingValues, ResearchMoney } from '#shared/schemas/fund-findings.ts'
import type { FundFinding } from '#shared/schemas/index.ts'
import { formatCurrencyAmount } from '#shared/funds/money.ts'
import { geoFocusLabel } from '#shared/utils/geo-focus.ts'

/** How a finding reads on the profile: a main line, an optional second line, and a link when the value is one. */
export type FindingDisplay = { title: string; detail: string | null; href: string | null }

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * Turn a finding's stored value into readable text.
 *
 * @param input.finding - The finding.
 * @returns Its display text.
 */
export function describeFinding({ finding }: { finding: Pick<FundFinding, 'field' | 'value'> }): FindingDisplay {
    const field = finding.field as FundResearchField
    const value = finding.value as never
    switch (field) {
        case 'summary':
            return plain({ title: (value as FundFindingValues['summary']).text })
        case 'website_url':
        case 'linkedin_url': {
            const url = (value as FundFindingValues['website_url']).url
            return { title: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), detail: null, href: url }
        }
        case 'social_account': {
            const account = value as FundFindingValues['social_account']
            return {
                title: account.platform,
                detail: account.url.replace(/^https?:\/\/(www\.)?/, ''),
                href: account.url,
            }
        }
        case 'year_established':
            return plain({ title: String((value as FundFindingValues['year_established']).year) })
        case 'headquarters': {
            const hq = value as FundFindingValues['headquarters']
            return plain({ title: [hq.city, countryName({ code: hq.country })].filter(Boolean).join(', ') })
        }
        case 'geographic_focus': {
            const focus = value as FundFindingValues['geographic_focus']
            return plain({ title: focus.codes.map(code => geoFocusLabel({ code })).join(', '), detail: focus.text })
        }
        case 'sectors':
            return plain({
                title: (value as FundFindingValues['sectors']).sectors
                    .map(sector => FUND_SECTOR_LABELS[sector as FundSector])
                    .join(', '),
            })
        case 'employee_count': {
            const team = value as FundFindingValues['employee_count']
            return plain({ title: team.count !== null ? `${team.count} people` : `${team.range} people` })
        }
        case 'contact': {
            const contact = value as FundFindingValues['contact']
            const href =
                contact.kind === 'email'
                    ? `mailto:${contact.value}`
                    : contact.kind === 'contact_page'
                      ? contact.value
                      : null
            return { title: contact.value, detail: contact.label, href }
        }
        case 'aum': {
            const aum = value as FundFindingValues['aum']
            return plain({ title: money({ money: aum }), detail: aum.as_of ? `As of ${aum.as_of}` : null })
        }
        case 'fund_raise': {
            const raise = value as FundFindingValues['fund_raise']
            const closeLabel = {
                final_close: 'Final close',
                first_close: 'First close',
                raising: 'Raising',
                unknown: null,
            }[raise.close_type]
            return plain({
                title: [raise.fund_name, raise.size ? money({ money: raise.size }) : null].filter(Boolean).join(' · '),
                detail: [closeLabel, raise.closed_on].filter(Boolean).join(' ') || null,
            })
        }
        case 'check_size': {
            const check = value as FundFindingValues['check_size']
            const amount = (amount: number | null) =>
                amount === null ? null : formatCurrencyAmount({ amount, currency: check.currency })
            const range = [amount(check.min), amount(check.max)]
            return plain({
                title:
                    range[0] && range[1]
                        ? `${range[0]}–${range[1]}`
                        : range[0]
                          ? `From ${range[0]}`
                          : `Up to ${range[1]}`,
                detail: check.note,
            })
        }
        case 'loan_types':
            return plain({
                title: (value as FundFindingValues['loan_types']).types
                    .map(type => LOAN_TYPE_LABELS[type as LoanType])
                    .join(', '),
            })
        case 'lender_archetype':
            return plain({
                title: LENDER_ARCHETYPE_LABELS[(value as FundFindingValues['lender_archetype']).archetype],
            })
        case 'loan_terms': {
            const terms = value as FundFindingValues['loan_terms']
            const tenor =
                terms.tenor_months_min !== null || terms.tenor_months_max !== null
                    ? `Tenor ${[terms.tenor_months_min, terms.tenor_months_max].filter(months => months !== null).join('–')} months`
                    : null
            return plain({
                title: [terms.pricing, tenor].filter(Boolean).join(' · ') || 'Collateral',
                detail: terms.collateral ? `Collateral: ${terms.collateral}` : null,
            })
        }
        case 'lending_currency': {
            const currency = value as FundFindingValues['lending_currency']
            return plain({
                title: CURRENCY_BASIS_LABELS[currency.basis],
                detail: currency.currencies.length > 0 ? currency.currencies.join(', ') : null,
            })
        }
        case 'lending_channel':
            return plain({ title: LENDING_CHANNEL_LABELS[(value as FundFindingValues['lending_channel']).channel] })
        case 'underwriting': {
            const underwriting = value as FundFindingValues['underwriting']
            return plain({
                title:
                    underwriting.approaches.map(approach => UNDERWRITING_APPROACH_LABELS[approach]).join(', ') ||
                    'Origination partners',
                detail: underwriting.origination_partners ? `Origination: ${underwriting.origination_partners}` : null,
            })
        }
        case 'risk_sharing': {
            const sharing = value as FundFindingValues['risk_sharing']
            return plain({
                title: `${RISK_SHARING_KIND_LABELS[sharing.kind]} from ${sharing.provider}`,
                detail: sharing.facility,
            })
        }
        case 'portfolio_scale': {
            const scale = value as FundFindingValues['portfolio_scale']
            return plain({
                title: [
                    scale.borrowers !== null ? `${scale.borrowers.toLocaleString('en-US')} borrowers` : null,
                    scale.loans !== null ? `${scale.loans.toLocaleString('en-US')} loans` : null,
                    scale.outstanding ? `${money({ money: scale.outstanding })} outstanding` : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
                detail: scale.as_of ? `As of ${scale.as_of}` : null,
            })
        }
        case 'deal': {
            const deal = value as FundFindingValues['deal']
            return plain({
                title: [deal.borrower, deal.amount ? money({ money: deal.amount }) : null].filter(Boolean).join(' · '),
                detail:
                    [
                        deal.loan_type ? LOAN_TYPE_LABELS[deal.loan_type] : null,
                        deal.country ? countryName({ code: deal.country }) : null,
                        deal.date,
                        deal.description,
                    ]
                        .filter(Boolean)
                        .join(' · ') || null,
            })
        }
        case 'lp': {
            const lp = value as FundFindingValues['lp']
            return plain({
                title: lp.name,
                detail:
                    [lp.fund_name, lp.amount ? money({ money: lp.amount }) : null].filter(Boolean).join(' · ') || null,
            })
        }
        case 'public_record': {
            const record = value as FundFindingValues['public_record']
            return plain({
                title: `${record.source_label}: ${record.recipient}`,
                detail:
                    [record.amount ? money({ money: record.amount }) : null, record.committed_on, record.description]
                        .filter(Boolean)
                        .join(' · ') || null,
            })
        }
        case 'impact_metric': {
            const metric = value as FundFindingValues['impact_metric']
            return plain({
                title: `${metric.value} ${metric.metric}`,
                detail: metric.as_of ? `As of ${metric.as_of}` : null,
            })
        }
        case 'success_story': {
            const story = value as FundFindingValues['success_story']
            return plain({ title: story.title, detail: story.summary })
        }
        case 'news': {
            const item = value as FundFindingValues['news']
            return plain({
                title: item.title,
                detail: [item.kind === 'press_release' ? 'Press release' : 'News', item.published_on]
                    .filter(Boolean)
                    .join(' · '),
            })
        }
        case 'conference': {
            const conference = value as FundFindingValues['conference']
            return plain({
                title: [conference.name, conference.year].filter(Boolean).join(' '),
                detail: conference.role,
            })
        }
        default:
            return plain({ title: JSON.stringify(finding.value) })
    }
}

/**
 * A country's English name from its ISO code.
 *
 * @param input.code - ISO 3166-1 alpha-2 code.
 * @returns The name, or the code when unknown.
 */
export function countryName({ code }: { code: string | null | undefined }) {
    if (!code) {
        return ''
    }
    try {
        return COUNTRY_NAMES.of(code) ?? code
    } catch {
        return code
    }
}

/**
 * Display text with no link.
 *
 * @param input.title - Main line.
 * @param input.detail - Second line.
 * @returns The display.
 */
function plain({ title, detail = null }: { title: string; detail?: string | null }): FindingDisplay {
    return { title, detail, href: null }
}

/**
 * An amount in its own currency, compact.
 *
 * @param input.money - The amount.
 * @returns "€1.2B", "$500K".
 */
function money({ money }: { money: ResearchMoney }) {
    return formatCurrencyAmount({ amount: money.amount, currency: money.currency })
}
