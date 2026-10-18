import { z } from 'zod'
import {
    CURRENCY_BASES,
    FUND_SECTORS,
    LENDER_ARCHETYPES,
    LENDING_CHANNELS,
    LOAN_TYPES,
    RISK_SHARING_KINDS,
    UNDERWRITING_APPROACHES,
} from '#shared/constants/funds.ts'

// The value of each research field. These shapes are also the research assistant's tool input
// (shared/schemas → JSON Schema), so they stay plain: no formats or min/max, which the structured
// tool input doesn't need. Ranges are checked after parsing (verifyFinding in server/utils/funds/).

// An amount in its original currency; converted to US cents only for sorting (shared/funds/money.ts).
export const ResearchMoney = z.object({
    amount: z.number().describe('Amount in major units, e.g. 1500000 for 1.5 million.'),
    currency: z.string().describe('ISO 4217 code, e.g. USD, EUR, KES.'),
})
export type ResearchMoney = z.infer<typeof ResearchMoney>

const PartialDate = z.string().describe('YYYY, YYYY-MM or YYYY-MM-DD, as precise as the source says.')

const UrlValue = z.object({ url: z.string() })

export const FUND_FINDING_VALUE_SCHEMAS = {
    summary: z.object({ text: z.string().describe('One or two neutral sentences.') }),
    website_url: UrlValue,
    linkedin_url: UrlValue,
    social_account: z.object({ platform: z.string(), url: z.string() }),
    year_established: z.object({ year: z.number().int() }),
    headquarters: z.object({
        city: z.string().nullable(),
        country: z.string().describe('ISO 3166-1 alpha-2 code, e.g. KE.'),
    }),
    geographic_focus: z.object({
        codes: z
            .array(z.string())
            .describe('ISO 3166-1 alpha-2 country codes, region codes like region:eastern_africa, or global.'),
        text: z.string().describe('How the source words it.'),
    }),
    sectors: z.object({ sectors: z.array(z.enum(FUND_SECTORS)) }),
    employee_count: z.object({
        count: z.number().int().nullable().describe('Exact number of employees, when the source gives one.'),
        range: z.string().nullable().describe('Headcount band, e.g. 11-50, when there is no exact count.'),
    }),
    contact: z.object({
        kind: z.enum(['email', 'phone', 'address', 'contact_page']),
        value: z.string().describe('The address, number, office address or contact page URL, exactly as published.'),
        label: z.string().nullable().describe('What it is for, e.g. "Investment enquiries" or "Nairobi office".'),
    }),
    aum: ResearchMoney.extend({ as_of: PartialDate.nullable() }),
    fund_raise: z.object({
        fund_name: z.string(),
        size: ResearchMoney.nullable(),
        close_type: z.enum(['final_close', 'first_close', 'raising', 'unknown']),
        closed_on: PartialDate.nullable(),
    }),
    check_size: z.object({
        min: z.number().nullable().describe('Smallest ticket in major units.'),
        max: z.number().nullable().describe('Largest ticket in major units.'),
        currency: z.string(),
        note: z.string().nullable(),
    }),
    loan_types: z.object({ types: z.array(z.enum(LOAN_TYPES)) }),
    lender_archetype: z.object({ archetype: z.enum(LENDER_ARCHETYPES) }),
    loan_terms: z.object({
        pricing: z.string().nullable().describe('Interest rate or range as published, e.g. "12–18% in USD".'),
        tenor_months_min: z.number().int().nullable(),
        tenor_months_max: z.number().int().nullable(),
        collateral: z.string().nullable().describe('Collateral or security they ask for, as published.'),
    }),
    lending_currency: z.object({
        basis: z.enum(CURRENCY_BASES),
        currencies: z.array(z.string()).describe('ISO 4217 codes they lend in, e.g. ["KES", "USD"].'),
    }),
    lending_channel: z.object({ channel: z.enum(LENDING_CHANNELS) }),
    underwriting: z.object({
        approaches: z.array(z.enum(UNDERWRITING_APPROACHES)),
        origination_partners: z
            .string()
            .nullable()
            .describe('Partners that bring them borrowers (OEMs, co-ops, offtakers).'),
    }),
    risk_sharing: z.object({
        kind: z.enum(RISK_SHARING_KINDS),
        provider: z.string().describe('Who provides it, e.g. IFC, FMO, USAID DCA.'),
        facility: z.string().nullable().describe('The facility or programme name, e.g. NASIRA.'),
    }),
    portfolio_scale: z.object({
        borrowers: z.number().int().nullable().describe('Borrowers financed to date.'),
        loans: z.number().int().nullable().describe('Loans made to date.'),
        outstanding: ResearchMoney.nullable().describe('Portfolio outstanding.'),
        as_of: PartialDate.nullable(),
    }),
    deal: z.object({
        borrower: z.string(),
        amount: ResearchMoney.nullable(),
        loan_type: z.enum(LOAN_TYPES).nullable(),
        date: PartialDate.nullable(),
        country: z.string().nullable().describe('ISO 3166-1 alpha-2 code.'),
        description: z.string().nullable(),
    }),
    lp: z.object({ name: z.string(), fund_name: z.string().nullable(), amount: ResearchMoney.nullable() }),
    public_record: z.object({
        source_key: z.string(),
        source_label: z.string(),
        record_id: z.string(),
        recipient: z.string(),
        amount: ResearchMoney.nullable(),
        committed_on: PartialDate.nullable(),
        description: z.string().nullable(),
    }),
    impact_metric: z.object({ metric: z.string(), value: z.string(), as_of: PartialDate.nullable() }),
    success_story: z.object({ title: z.string(), summary: z.string() }),
    news: z.object({
        title: z.string(),
        published_on: PartialDate.nullable(),
        kind: z.enum(['news', 'press_release']),
    }),
    conference: z.object({ name: z.string(), year: z.number().int().nullable(), role: z.string().nullable() }),
} as const

export type FundFindingValues = {
    [Field in keyof typeof FUND_FINDING_VALUE_SCHEMAS]: z.infer<(typeof FUND_FINDING_VALUE_SCHEMAS)[Field]>
}
