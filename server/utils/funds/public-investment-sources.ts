// The public DFI, multilateral and US government lists of investments and grants that fund research
// cross-references and spiders from. Each has an adapter:
// - html_pages: list pages read one at a time (through Firecrawl when FIRECRAWL_API_KEY is set, which
//   renders JavaScript and gets past bot blocking); the AI extracts the rows and the next page's link.
// - spreadsheet_link: a landing page that links a dated Excel/CSV download (the newest link is used).
// - usaspending: US federal awards from the USAspending.gov API (no AI needed; every recipient is a lender).
// Sites change; a list that stops working shows its error in Settings → Research without affecting the others.

export type PublicInvestmentAdapter =
    | { type: 'html_pages'; startUrl: string }
    | { type: 'spreadsheet_link'; pageUrl: string }
    | { type: 'usaspending'; filters: Record<string, unknown> }

export type PublicInvestmentSourceDefinition = {
    key: string
    label: string
    publisherKind: 'dfi' | 'multilateral' | 'us_government'
    // Where a person can see the list.
    url: string
    adapter: PublicInvestmentAdapter
}

// Federal grant award type codes (USAspending): block, formula, project grants and cooperative agreements.
const GRANT_AWARD_TYPES = ['02', '03', '04', '05']

export const PUBLIC_INVESTMENT_SOURCES: PublicInvestmentSourceDefinition[] = [
    {
        key: 'norfund',
        label: 'Norfund',
        publisherKind: 'dfi',
        url: 'https://www.norfund.no/investment-overview/',
        adapter: { type: 'spreadsheet_link', pageUrl: 'https://www.norfund.no/investment-overview/' },
    },
    {
        key: 'bii',
        label: 'British International Investment',
        publisherKind: 'dfi',
        url: 'https://www.bii.co.uk/en/our-impact/search-results/',
        adapter: { type: 'html_pages', startUrl: 'https://www.bii.co.uk/en/our-impact/search-results/' },
    },
    {
        key: 'fmo',
        label: 'FMO',
        publisherKind: 'dfi',
        url: 'https://www.fmo.nl/world-map',
        adapter: { type: 'html_pages', startUrl: 'https://www.fmo.nl/world-map' },
    },
    {
        key: 'proparco',
        label: 'Proparco',
        publisherKind: 'dfi',
        url: 'https://www.proparco.fr/en/projects/list',
        adapter: { type: 'html_pages', startUrl: 'https://www.proparco.fr/en/projects/list' },
    },
    {
        key: 'deg',
        label: 'DEG',
        publisherKind: 'dfi',
        url: 'https://www.deginvest.de/Unsere-Investitionen/Portfolio/index-2.html',
        adapter: {
            type: 'html_pages',
            startUrl: 'https://www.deginvest.de/Unsere-Investitionen/Portfolio/index-2.html',
        },
    },
    {
        key: 'swedfund',
        label: 'Swedfund',
        publisherKind: 'dfi',
        url: 'https://www.swedfund.se/en/investments/',
        adapter: { type: 'html_pages', startUrl: 'https://www.swedfund.se/en/investments/' },
    },
    {
        key: 'finnfund',
        label: 'Finnfund',
        publisherKind: 'dfi',
        url: 'https://www.finnfund.fi/en/current-investments/',
        adapter: { type: 'html_pages', startUrl: 'https://www.finnfund.fi/en/current-investments/' },
    },
    {
        key: 'ifu',
        label: 'IFU',
        publisherKind: 'dfi',
        url: 'https://www.ifu.dk/portfolio/',
        adapter: { type: 'html_pages', startUrl: 'https://www.ifu.dk/portfolio/' },
    },
    {
        key: 'ifc',
        label: 'IFC',
        publisherKind: 'multilateral',
        url: 'https://disclosures.ifc.org/enterprise-search-results-home',
        adapter: { type: 'html_pages', startUrl: 'https://disclosures.ifc.org/enterprise-search-results-home' },
    },
    {
        key: 'idb_invest',
        label: 'IDB Invest',
        publisherKind: 'multilateral',
        url: 'https://idbinvest.org/en/projects',
        adapter: { type: 'html_pages', startUrl: 'https://idbinvest.org/en/projects' },
    },
    {
        key: 'afdb',
        label: 'African Development Bank',
        publisherKind: 'multilateral',
        url: 'https://www.afdb.org/en/projects-and-operations/project-portfolio',
        adapter: { type: 'html_pages', startUrl: 'https://www.afdb.org/en/projects-and-operations/project-portfolio' },
    },
    {
        key: 'adb',
        label: 'Asian Development Bank',
        publisherKind: 'multilateral',
        url: 'https://www.adb.org/projects?terms=private%20sector%20financial%20intermediary',
        adapter: {
            type: 'html_pages',
            startUrl: 'https://www.adb.org/projects?terms=private%20sector%20financial%20intermediary',
        },
    },
    {
        key: 'us_dfc',
        label: 'US DFC',
        publisherKind: 'us_government',
        url: 'https://www.dfc.gov/what-we-do/active-projects',
        adapter: { type: 'html_pages', startUrl: 'https://www.dfc.gov/what-we-do/active-projects' },
    },
    {
        key: 'cdfi_fund',
        label: 'CDFI Fund awards (US Treasury)',
        publisherKind: 'us_government',
        url: 'https://www.usaspending.gov/agency/department-of-the-treasury',
        adapter: {
            type: 'usaspending',
            filters: {
                award_type_codes: GRANT_AWARD_TYPES,
                agencies: [
                    { type: 'awarding', tier: 'subtier', name: 'Community Development Financial Institutions Fund' },
                ],
            },
        },
    },
    {
        key: 'sba_microloan',
        label: 'SBA Microloan intermediaries',
        publisherKind: 'us_government',
        url: 'https://www.sba.gov/partners/lenders/microloan-program',
        // Assistance listing 59.046: grants to the nonprofit lenders that run SBA microloans.
        adapter: { type: 'usaspending', filters: { award_type_codes: GRANT_AWARD_TYPES, program_numbers: ['59.046'] } },
    },
    {
        key: 'usda_rural_business',
        label: 'USDA Intermediary Relending Program',
        publisherKind: 'us_government',
        url: 'https://www.rd.usda.gov/programs-services/business-programs/intermediary-relending-program',
        // Assistance listing 10.767: loans to intermediaries that relend to rural businesses.
        adapter: { type: 'usaspending', filters: { award_type_codes: ['07', '08'], program_numbers: ['10.767'] } },
    },
]

/**
 * Find a list definition.
 *
 * @param input.key - The list's key.
 * @returns The definition, or undefined.
 */
export function findPublicInvestmentSource({ key }: { key: string }) {
    return PUBLIC_INVESTMENT_SOURCES.find(source => source.key === key)
}
