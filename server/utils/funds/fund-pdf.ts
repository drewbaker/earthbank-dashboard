import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { AffiliationRelation } from '#shared/constants/funds.ts'
import {
    FUND_DILIGENCE_QUESTION_DETAILS,
    FUND_FIT_TAG_LABELS,
    FUND_RESEARCH_FIELD_DETAILS,
    FUND_RESEARCH_FIELDS,
    FUND_RESEARCH_GROUP_LABELS,
    FUND_RESEARCH_GROUPS,
    FUND_STAGE_DETAILS,
    LENDER_ARCHETYPE_LABELS,
    LENDING_CHANNEL_LABELS,
    LOAN_TYPE_LABELS,
    TICKET_FIT_DETAILS,
} from '#shared/constants/funds.ts'
import { countryName, describeFinding } from '#shared/funds/finding-display.ts'
import { formatCurrencyAmount } from '#shared/funds/money.ts'
import type { FundDetail, FundSourceLink } from '#shared/schemas/index.ts'
import { displayUrl } from '#shared/utils/display-url.ts'
import { geoFocusLabel } from '#shared/utils/geo-focus.ts'

const RELATION_LABELS: Record<AffiliationRelation, string> = {
    employment: 'Worked at',
    education: 'Studied at',
    board: 'Board of',
}

// Muted greys and the dashboard's green, so the PDF reads like the app.
const COLORS = { text: '#18181b', muted: '#71717a', rule: '#e4e4e7', accent: '#15803d' }

/** Numbers each source the first time it's cited, so facts can point to a numbered list at the end. */
type SourceIndex = { numberFor: (source: FundSourceLink) => number; sources: FundSourceLink[] }

/**
 * Lay out a fund's profile as a PDF for meeting prep: at a glance, the team's notes, research by
 * section (each fact numbered to its sources), the team, due diligence with open questions marked,
 * and the numbered sources with links.
 *
 * @param input.fund - The fund's full profile.
 * @param input.preparedOn - Today's date (YYYY-MM-DD) for the header.
 * @returns The pdfmake document.
 */
export function buildFundPdf({ fund, preparedOn }: { fund: FundDetail; preparedOn: string }): TDocumentDefinitions {
    const sourceIndex = createSourceIndex()
    const content: Content[] = [
        { text: fund.name, style: 'title' },
        {
            text:
                [fund.website_url, fund.linkedin_url]
                    .filter(Boolean)
                    .map(url => displayUrl({ url: url! }))
                    .join('  ·  ') || 'No website yet',
            style: 'muted',
        },
        { text: `Prepared ${formatDay({ date: preparedOn })} from the Earth Bank Dashboard`, style: 'muted' },
        ...(fund.summary ? [{ text: fund.summary, margin: [0, 10, 0, 0] } as Content] : []),
        sectionHeading({ text: 'At a glance' }),
        keyValueTable({ rows: glanceRows({ fund }) }),
        ...teamNotes({ notes: fund.notes }),
        ...researchSections({ fund, sourceIndex }),
        ...peopleSection({ fund, sourceIndex }),
        ...diligenceSection({ fund }),
        ...sourcesSection({ sources: sourceIndex.sources }),
    ]
    return {
        info: { title: `${fund.name} · Earth Bank Dashboard` },
        pageSize: 'LETTER',
        pageMargins: [48, 48, 48, 56],
        content,
        footer: (currentPage, pageCount) => ({
            columns: [
                { text: fund.name, style: 'footer' },
                { text: `${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' },
            ],
            margin: [48, 16, 48, 0],
        }),
        defaultStyle: { fontSize: 10, lineHeight: 1.25, color: COLORS.text },
        styles: {
            title: { fontSize: 22, bold: true, margin: [0, 0, 0, 4] },
            heading: { fontSize: 13, bold: true, color: COLORS.accent, margin: [0, 18, 0, 6] },
            subheading: { fontSize: 10.5, bold: true, margin: [0, 10, 0, 4] },
            label: { color: COLORS.muted },
            muted: { color: COLORS.muted, fontSize: 9 },
            footer: { color: COLORS.muted, fontSize: 8 },
            link: { color: COLORS.accent },
        },
    }
}

/**
 * The summary rows: the team's fields first, then the headline research values.
 *
 * @param input.fund - The fund.
 * @returns Label and value pairs; missing values read "Not found yet".
 */
function glanceRows({ fund }: { fund: FundDetail }): [string, string][] {
    const usd = (cents: number | null) =>
        cents === null ? null : formatCurrencyAmount({ amount: cents / 100, currency: 'USD' })
    const checkSize =
        fund.check_min_cents === null && fund.check_max_cents === null
            ? null
            : [fund.check_min_cents, fund.check_max_cents].map(cents => usd(cents) ?? '?').join('–')
    const workingCapital = fund.has_working_capital_loans
        ? fund.max_working_capital_loan_cents === null
            ? 'Yes'
            : `Yes, up to ${usd(fund.max_working_capital_loan_cents)}`
        : null
    const headquarters = [fund.hq_city, countryName({ code: fund.hq_country })].filter(Boolean).join(', ')
    const rows: [string, string | null][] = [
        ['Stage', FUND_STAGE_DETAILS[fund.stage].label],
        ['Owner', fund.owner?.name ?? 'No owner'],
        ['Fit', fund.fit_tags.map(tag => FUND_FIT_TAG_LABELS[tag]).join(', ') || null],
        ['Our ticket ($500K–$5M)', fund.ticket_fit ? TICKET_FIT_DETAILS[fund.ticket_fit].label : null],
        ['Lender type', fund.lender_archetype ? LENDER_ARCHETYPE_LABELS[fund.lender_archetype] : null],
        ['Direct or on-lending', fund.lending_channel ? LENDING_CHANNEL_LABELS[fund.lending_channel] : null],
        ['AUM', usd(fund.aum_cents)],
        ['Latest fund', usd(fund.latest_fund_size_cents)],
        ['Last close', fund.last_fund_close_on ? formatDay({ date: fund.last_fund_close_on }) : null],
        ['Check size', checkSize],
        ['Working capital loans', workingCapital],
        ['Loan types', fund.loan_types.map(type => LOAN_TYPE_LABELS[type]).join(', ') || null],
        ['Local currency lending', fund.lends_local_currency ? 'Yes' : null],
        ['Regional focus', fund.focus_areas.map(code => geoFocusLabel({ code })).join(', ') || null],
        ['Headquarters', headquarters || null],
        ['Founded', fund.year_established ? String(fund.year_established) : null],
        ['Team size', fund.employee_range ?? (fund.employee_count ? String(fund.employee_count) : null)],
        ['Research / diligence', `${fund.research_completeness}% / ${fund.diligence_completeness}% complete`],
    ]
    return rows.map(([label, value]) => [label, value ?? 'Not found yet'])
}

/**
 * The team's own notes, when there are any.
 *
 * @param input.notes - The notes.
 * @returns The section, or nothing.
 */
function teamNotes({ notes }: { notes: string | null }): Content[] {
    return notes?.trim() ? [sectionHeading({ text: 'Team notes' }), { text: notes.trim() }] : []
}

/**
 * Research findings grouped as on the fund page, each value followed by its source numbers.
 * Fields with nothing found are listed together per section, so gaps are visible.
 *
 * @param input.fund - The fund.
 * @param input.sourceIndex - Numbers the sources as they're cited.
 * @returns The sections.
 */
function researchSections({ fund, sourceIndex }: { fund: FundDetail; sourceIndex: SourceIndex }): Content[] {
    const activeFindings = fund.findings.filter(finding => finding.status === 'active')
    const content: Content[] = [sectionHeading({ text: 'Research' })]
    for (const group of FUND_RESEARCH_GROUPS) {
        const fields = FUND_RESEARCH_FIELDS.filter(field => FUND_RESEARCH_FIELD_DETAILS[field].group === group)
        const rows: [string, Content][] = []
        const missingLabels: string[] = []
        for (const field of fields) {
            const findings = activeFindings.filter(finding => finding.field === field)
            if (!findings.length) {
                missingLabels.push(FUND_RESEARCH_FIELD_DETAILS[field].label)
                continue
            }
            rows.push([
                FUND_RESEARCH_FIELD_DETAILS[field].label,
                {
                    stack: findings.map(finding => {
                        const display = describeFinding({ finding })
                        return {
                            stack: [
                                {
                                    text: [
                                        display.href
                                            ? { text: display.title, link: display.href, style: 'link' }
                                            : display.title,
                                        sourceMarks({ sources: finding.sources, sourceIndex }),
                                    ],
                                },
                                ...(display.detail ? [{ text: display.detail, style: 'muted' } as Content] : []),
                            ],
                            margin: [0, 0, 0, 3],
                        } as Content
                    }),
                },
            ])
        }
        content.push({ text: FUND_RESEARCH_GROUP_LABELS[group], style: 'subheading' })
        if (rows.length) {
            content.push(keyValueTable({ rows }))
        }
        if (missingLabels.length) {
            content.push({ text: `Not found yet: ${missingLabels.join(', ')}`, style: 'muted', margin: [0, 2, 0, 0] })
        }
    }
    return content
}

/**
 * The team: each person with title, links, bio and work history.
 *
 * @param input.fund - The fund.
 * @param input.sourceIndex - Numbers the sources as they're cited.
 * @returns The section, or nothing when no one was found.
 */
function peopleSection({ fund, sourceIndex }: { fund: FundDetail; sourceIndex: SourceIndex }): Content[] {
    if (!fund.people.length) {
        return [sectionHeading({ text: 'Team' }), { text: 'No team members found yet.', style: 'muted' }]
    }
    return [
        sectionHeading({ text: 'Team' }),
        ...fund.people.map(
            person =>
                ({
                    stack: [
                        {
                            text: [
                                { text: person.name, bold: true },
                                person.is_principal ? { text: '  Principal', color: COLORS.accent, fontSize: 8.5 } : '',
                                person.title ? { text: `  ${person.title}`, style: 'label' } : '',
                                sourceMarks({ sources: person.sources, sourceIndex }),
                            ],
                        },
                        ...(person.linkedin_url || person.email
                            ? [
                                  {
                                      text: [
                                          person.linkedin_url
                                              ? { text: 'LinkedIn', link: person.linkedin_url, style: 'link' }
                                              : '',
                                          person.linkedin_url && person.email ? '  ·  ' : '',
                                          person.email
                                              ? { text: person.email, link: `mailto:${person.email}`, style: 'link' }
                                              : '',
                                      ],
                                      fontSize: 9,
                                  } as Content,
                              ]
                            : []),
                        ...(person.bio_summary ? [{ text: person.bio_summary } as Content] : []),
                        ...(person.affiliations.length
                            ? [
                                  {
                                      ul: person.affiliations.map(affiliation => ({
                                          text: [
                                              `${RELATION_LABELS[affiliation.relation]} ${affiliation.organization.name}`,
                                              affiliation.title ? `, ${affiliation.title}` : '',
                                              affiliation.start_year || affiliation.end_year
                                                  ? ` (${affiliation.start_year ?? '?'}–${affiliation.end_year ?? 'now'})`
                                                  : '',
                                              sourceMarks({ sources: affiliation.sources, sourceIndex }),
                                          ],
                                      })),
                                      fontSize: 9,
                                      margin: [0, 2, 0, 0],
                                  } as Content,
                              ]
                            : []),
                    ],
                    margin: [0, 0, 0, 10],
                    unbreakable: true,
                }) as Content,
        ),
    ]
}

/**
 * Due diligence: answers with who gave them, and open questions with what to ask.
 *
 * @param input.fund - The fund.
 * @returns The section.
 */
function diligenceSection({ fund }: { fund: FundDetail }): Content[] {
    const rows: [string, Content][] = fund.diligence.map(item => {
        const details = FUND_DILIGENCE_QUESTION_DETAILS[item.question]
        if (!item.answer) {
            return [details.label, { text: [{ text: 'Open. ', bold: true, color: '#b45309' }, details.hint] }]
        }
        const answeredBy =
            item.source === 'ai' ? 'From public sources (AI)' : `From ${item.answered_by?.name ?? 'the team'}`
        return [
            details.label,
            {
                stack: [
                    { text: item.answer },
                    { text: answeredBy, style: 'muted' },
                    ...item.source_urls.map(url => ({ text: url, link: url, style: ['muted', 'link'] }) as Content),
                ],
            },
        ]
    })
    return [sectionHeading({ text: 'Due diligence' }), keyValueTable({ rows })]
}

/**
 * The numbered list of every page cited above.
 *
 * @param input.sources - Sources in citation order.
 * @returns The section, or nothing when nothing was cited.
 */
function sourcesSection({ sources }: { sources: FundSourceLink[] }): Content[] {
    if (!sources.length) {
        return []
    }
    return [
        sectionHeading({ text: 'Sources' }),
        {
            ol: sources.map(source => ({
                stack: [
                    { text: source.title ?? source.domain },
                    { text: source.url, link: source.url, style: ['muted', 'link'] },
                ],
                margin: [0, 0, 0, 3],
            })),
            fontSize: 9,
        },
    ]
}

/**
 * Superscript source numbers after a fact, each linking to its page.
 *
 * @param input.sources - The fact's sources.
 * @param input.sourceIndex - Numbers the sources as they're cited.
 * @returns Inline text, or an empty string when there are none.
 */
function sourceMarks({ sources, sourceIndex }: { sources: FundSourceLink[]; sourceIndex: SourceIndex }): Content {
    if (!sources.length) {
        return ''
    }
    return {
        // pdfmake only raises inline pieces that are marked themselves, not their container.
        text: sources.flatMap((source, index) => [
            { text: index ? ',' : ' ', sup: true },
            { text: String(sourceIndex.numberFor(source)), link: source.url, sup: true },
        ]),
        color: COLORS.accent,
    }
}

/**
 * A source numberer: the same page always gets the same number.
 *
 * @returns The index.
 */
function createSourceIndex(): SourceIndex {
    const numbers = new Map<string, number>()
    const sources: FundSourceLink[] = []
    return {
        sources,
        numberFor: source => {
            const existing = numbers.get(source.url)
            if (existing) {
                return existing
            }
            sources.push(source)
            numbers.set(source.url, sources.length)
            return sources.length
        },
    }
}

/**
 * A two-column table of labels and values with light row rules.
 *
 * @param input.rows - Label and value pairs.
 * @returns The table.
 */
function keyValueTable({ rows }: { rows: [string, Content][] }): Content {
    return {
        table: {
            widths: [140, '*'],
            body: rows.map(([label, value]) => [{ text: label, style: 'label' }, value]),
        },
        layout: {
            hLineWidth: (index, node) => (index === 0 || index === node.table.body.length ? 0 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => COLORS.rule,
            paddingLeft: () => 0,
            paddingRight: () => 8,
            paddingTop: () => 4,
            paddingBottom: () => 4,
        },
    }
}

/**
 * A section heading.
 *
 * @param input.text - The heading.
 * @returns The heading content.
 */
function sectionHeading({ text }: { text: string }): Content {
    return { text, style: 'heading' }
}

/**
 * A calendar date as "Oct 18, 2026".
 *
 * @param input.date - YYYY-MM-DD.
 * @returns The formatted date.
 */
function formatDay({ date }: { date: string }) {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${date}T00:00:00Z`),
    )
}
