// Fixed vocabularies for fund research (the Funds page), shared by the API, the UI and the research jobs.
// Colors are Nuxt UI semantic colors so badges follow the theme and dark mode.

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

// The team's own stages, carried over from the Airtable "Fund Manager Research" board.
export const FUND_STAGES = ['new_addition', 'sourced', 'in_diligence', 'shortlisted', 'passed'] as const
export type FundStage = (typeof FUND_STAGES)[number]

export const FUND_STAGE_DETAILS: Record<FundStage, { label: string; color: BadgeColor }> = {
    new_addition: { label: 'New additions', color: 'info' },
    sourced: { label: 'Sourced', color: 'neutral' },
    in_diligence: { label: 'In diligence', color: 'warning' },
    shortlisted: { label: 'Shortlisted', color: 'success' },
    passed: { label: 'Passed', color: 'error' },
}

export const FUND_FIT_TAGS = [
    'too_big_could_come_down_market',
    'worked_example',
    'fragmentation_connector',
    'adjacent_market_specialist',
] as const
export type FundFitTag = (typeof FUND_FIT_TAGS)[number]

export const FUND_FIT_TAG_LABELS: Record<FundFitTag, string> = {
    too_big_could_come_down_market: 'Too big – could come down-market',
    worked_example: 'Worked example',
    fragmentation_connector: 'Fragmentation connector',
    adjacent_market_specialist: 'Adjacent market specialist',
}

// How a fund got onto the list.
export const FUND_ORIGINS = ['seed', 'manual', 'spider_person', 'spider_public_record', 'spider_suggestion'] as const
export type FundOrigin = (typeof FUND_ORIGINS)[number]

export const FUND_ORIGIN_LABELS: Record<FundOrigin, string> = {
    seed: 'Seed list',
    manual: 'Added by the team',
    spider_person: "Found through a team member's past work",
    spider_public_record: 'Found in a DFI or government list',
    spider_suggestion: 'Found while researching another fund',
}

// Funds the spider finds wait as pending until someone approves them; funds people add are approved.
export const FUND_APPROVAL_STATUSES = ['pending', 'approved'] as const
export type FundApprovalStatus = (typeof FUND_APPROVAL_STATUSES)[number]

export const FUND_RESEARCH_STATUSES = ['awaiting_approval', 'queued', 'running', 'done', 'failed', 'skipped'] as const
export type FundResearchStatus = (typeof FUND_RESEARCH_STATUSES)[number]

export const FUND_RESEARCH_STATUS_DETAILS: Record<FundResearchStatus, { label: string; color: BadgeColor }> = {
    awaiting_approval: { label: 'Not researched', color: 'neutral' },
    queued: { label: 'Waiting', color: 'neutral' },
    running: { label: 'Researching', color: 'info' },
    done: { label: 'Researched', color: 'success' },
    failed: { label: 'Failed', color: 'error' },
    skipped: { label: 'Paused', color: 'warning' },
}

export const FUND_SECTORS = [
    'agriculture',
    'electrification',
    'energy',
    'clean_cooking',
    'water',
    'mobility',
    'buildings',
    'circular_economy',
    'forestry_nature',
    'blue_economy',
    'climate_adaptation',
    'distributed_energy',
    'energy_efficiency',
    'utilities',
    'agro_processing',
    'clean_industrials',
    'alternative_materials',
    'alternative_proteins',
    'sustainable_textiles',
    'retrofitting',
    'space',
    'financial_inclusion',
    'sme',
    'health',
    'education',
    'other',
] as const
export type FundSector = (typeof FUND_SECTORS)[number]

export const FUND_SECTOR_LABELS: Record<FundSector, string> = {
    agriculture: 'Agriculture',
    electrification: 'Electrification',
    energy: 'Energy',
    clean_cooking: 'Clean cooking',
    water: 'Water & sanitation',
    mobility: 'E-mobility',
    buildings: 'Buildings & housing',
    circular_economy: 'Circular economy',
    forestry_nature: 'Forestry & nature',
    blue_economy: 'Blue economy',
    climate_adaptation: 'Climate adaptation',
    distributed_energy: 'Distributed energy',
    energy_efficiency: 'Energy efficiency',
    utilities: 'Improved utilities',
    agro_processing: 'Agro-processing',
    clean_industrials: 'Clean industrials',
    alternative_materials: 'Alternative plastics & materials',
    alternative_proteins: 'Alternative proteins',
    sustainable_textiles: 'Sustainable textiles',
    retrofitting: 'Building retrofits',
    space: 'Space',
    financial_inclusion: 'Financial inclusion',
    sme: 'SMEs (general)',
    health: 'Health',
    education: 'Education',
    other: 'Other',
}

export const LOAN_TYPES = [
    'working_capital',
    'credit_line',
    'trade_finance',
    'inventory',
    'receivables',
    'project_debt',
    'term_debt',
    'asset_finance',
    'revenue_based',
    'mezzanine',
    'on_lending',
    'guarantee',
    'equity',
    'grant',
] as const
export type LoanType = (typeof LOAN_TYPES)[number]

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
    working_capital: 'Working capital',
    credit_line: 'Lines of credit',
    trade_finance: 'Trade finance',
    inventory: 'Inventory finance',
    receivables: 'Receivables / invoice finance',
    project_debt: 'Project debt',
    term_debt: 'Term debt',
    asset_finance: 'Asset / equipment finance',
    revenue_based: 'Revenue-based finance',
    mezzanine: 'Mezzanine',
    on_lending: 'Lending to lenders (on-lending)',
    guarantee: 'Guarantees',
    equity: 'Equity',
    grant: 'Grants',
}

// Loan types that count as working-capital lending for the "made working-capital loans" filter.
export const WORKING_CAPITAL_LOAN_TYPES: readonly LoanType[] = [
    'working_capital',
    'credit_line',
    'trade_finance',
    'inventory',
    'receivables',
]

// Signals that a lender is worth tracking and researching (the team's criteria). Each is met, not met
// or unknown, worked out from research after every run (deriveFundFitSignals).
export const FUND_FIT_SIGNALS = [
    'raised_funds',
    'established_3_years',
    'managed_10m',
    'working_capital_or_term_debt',
    'has_lps',
    'target_sectors',
    'recently_active',
] as const
export type FundFitSignal = (typeof FUND_FIT_SIGNALS)[number]

export const FUND_FIT_SIGNAL_STATUSES = ['met', 'not_met', 'unknown'] as const
export type FundFitSignalStatus = (typeof FUND_FIT_SIGNAL_STATUSES)[number]

export const FUND_FIT_SIGNAL_LABELS: Record<FundFitSignal, string> = {
    raised_funds: 'Has raised funds before',
    established_3_years: '3+ years old',
    managed_10m: 'Managed $10M+',
    working_capital_or_term_debt: 'Working capital, credit lines or term debt',
    has_lps: 'Raised from limited partners',
    target_sectors: 'Lends in our sectors',
    recently_active: 'Public activity in the last 12 months',
}

// Managing this much (AUM, or one fund's size) is a good sign, though not a hard rule.
export const FIT_SIGNAL_MANAGED_CENTS = 10_000_000 * 100
export const FIT_SIGNAL_MIN_YEARS = 3
// A fund with no public activity for this long may have closed.
export const RECENT_ACTIVITY_MONTHS = 12

// Loan types that show working-capital, credit-line or term-debt experience.
export const FIT_SIGNAL_LOAN_TYPES: readonly LoanType[] = ['working_capital', 'credit_line', 'term_debt']

// The only sectors Earth Bank wants its lenders to work in: energy (including electrification and clean
// cooking), distributed energy, clean industrials, agriculture, agro-processing, energy efficiency
// (including building retrofits), e-mobility and improved utilities (power, water, sanitation).
export const TARGET_SECTORS: readonly FundSector[] = [
    'energy',
    'electrification',
    'clean_cooking',
    'distributed_energy',
    'clean_industrials',
    'agriculture',
    'agro_processing',
    'energy_efficiency',
    'retrofitting',
    'mobility',
    'utilities',
    'water',
]

// The target sectors as one line for AI instructions.
export const TARGET_SECTORS_TEXT =
    'energy, distributed energy, clean industrials, agriculture, energy efficiency, e-mobility, improved utilities (power, water, sanitation) and agro-processing'

// The size the team cares most about: working-capital loans of at least $500K.
export const WORKING_CAPITAL_TARGET_CENTS = 500_000 * 100

export const FUND_SOURCE_KINDS = [
    'fund_website',
    'linkedin',
    'news',
    'press_release',
    'dfi_database',
    'government_database',
    'report',
    'data_provider',
    // A call note or document the team imported on the fund's Import tab.
    'team_note',
    'other',
] as const
export type FundSourceKind = (typeof FUND_SOURCE_KINDS)[number]

export const FUND_SOURCE_KIND_LABELS: Record<FundSourceKind, string> = {
    fund_website: 'Fund website',
    linkedin: 'LinkedIn',
    news: 'News',
    press_release: 'Press release',
    dfi_database: 'DFI database',
    government_database: 'Government database',
    report: 'Report',
    data_provider: 'Data provider',
    team_note: 'Team note',
    other: 'Other',
}

export const RESEARCH_ORGANIZATION_KINDS = [
    'lender',
    'investor',
    'bank',
    'dfi',
    'government',
    'school',
    'company',
    'other',
] as const
export type ResearchOrganizationKind = (typeof RESEARCH_ORGANIZATION_KINDS)[number]

export const AFFILIATION_RELATIONS = ['employment', 'education', 'board'] as const
export type AffiliationRelation = (typeof AFFILIATION_RELATIONS)[number]

// What kind of lender it is (the archetypes the consultants' proposals screen by).
export const LENDER_ARCHETYPES = [
    'climate_private_debt',
    'generalist_private_credit',
    'blended_finance_fund',
    'digital_lender',
    'supply_chain_finance',
    'bank_nbfi',
    'microfinance',
    'cdfi',
    'other',
] as const
export type LenderArchetype = (typeof LENDER_ARCHETYPES)[number]

export const LENDER_ARCHETYPE_LABELS: Record<LenderArchetype, string> = {
    climate_private_debt: 'Climate private debt fund',
    generalist_private_credit: 'Generalist private credit fund',
    blended_finance_fund: 'Blended-finance fund or facility',
    digital_lender: 'Digital / embedded lender',
    supply_chain_finance: 'Supply-chain / receivables platform',
    bank_nbfi: 'Bank or non-bank financial institution',
    microfinance: 'Microfinance institution',
    cdfi: 'CDFI / community lender',
    other: 'Other',
}

// Whether a lender lends to businesses itself, or through other lenders (local banks, MFIs).
export const LENDING_CHANNELS = ['direct', 'on_lending', 'both'] as const
export type LendingChannel = (typeof LENDING_CHANNELS)[number]

export const LENDING_CHANNEL_LABELS: Record<LendingChannel, string> = {
    direct: 'Lends directly',
    on_lending: 'Lends through other lenders',
    both: 'Direct and through lenders',
}

// What a loan is lent in: the borrower's local currency, a hard currency (USD, EUR), or either.
export const CURRENCY_BASES = ['local', 'hard', 'both'] as const
export type CurrencyBasis = (typeof CURRENCY_BASES)[number]

export const CURRENCY_BASIS_LABELS: Record<CurrencyBasis, string> = {
    local: 'Local currency',
    hard: 'Hard currency',
    both: 'Local and hard currency',
}

export const UNDERWRITING_APPROACHES = [
    'cash_flow',
    'collateral',
    'invoice_buyer',
    'data_led',
    'asset_backed',
    'relationship',
] as const
export type UnderwritingApproach = (typeof UNDERWRITING_APPROACHES)[number]

export const UNDERWRITING_APPROACH_LABELS: Record<UnderwritingApproach, string> = {
    cash_flow: 'Cash-flow based',
    collateral: 'Collateral based',
    invoice_buyer: 'Invoice / buyer based',
    data_led: 'Data-led (digital scoring)',
    asset_backed: 'Asset-backed',
    relationship: 'Relationship / character based',
}

// First-loss, guarantees and other risk-sharing the lender already uses (e.g. IFC first-loss, FMO NASIRA).
export const RISK_SHARING_KINDS = ['first_loss', 'guarantee', 'junior_tranche', 'technical_assistance'] as const
export type RiskSharingKind = (typeof RISK_SHARING_KINDS)[number]

export const RISK_SHARING_KIND_LABELS: Record<RiskSharingKind, string> = {
    first_loss: 'First-loss capital',
    guarantee: 'Guarantee',
    junior_tranche: 'Junior / catalytic tranche',
    technical_assistance: 'Technical assistance facility',
}

// Earth Bank's target loan size; a fund's check-size range is compared with it ("ticket fit").
export const EARTH_BANK_TICKET = { minCents: 500_000 * 100, maxCents: 5_000_000 * 100 } as const

export const TICKET_FITS = ['fits', 'partly', 'outside'] as const
export type TicketFit = (typeof TICKET_FITS)[number]

export const TICKET_FIT_DETAILS: Record<TicketFit, { label: string; color: 'success' | 'warning' | 'neutral' }> = {
    fits: { label: 'Fits $500K–$5M', color: 'success' },
    partly: { label: 'Partly fits', color: 'warning' },
    outside: { label: 'Outside our range', color: 'neutral' },
}

export const FUND_RESEARCH_GROUPS = ['basics', 'lending', 'model', 'track_record', 'presence'] as const
export type FundResearchGroup = (typeof FUND_RESEARCH_GROUPS)[number]

export const FUND_RESEARCH_GROUP_LABELS: Record<FundResearchGroup, string> = {
    basics: 'Basics',
    lending: 'Size & lending',
    model: 'Lending model',
    track_record: 'Track record',
    presence: 'News & presence',
}

// Everything the research assistant looks for. `isList` fields keep one finding per item (deals,
// LPs, news…); the rest keep one current value. `isLinkOnly` fields are themselves a URL, so a
// search result is enough evidence (LinkedIn and social pages can't be fetched). `weight` counts
// toward research completeness; 0 means the field never counts (it's filled by cross-referencing).
export const FUND_RESEARCH_FIELDS = [
    'summary',
    'website_url',
    'linkedin_url',
    'social_account',
    'year_established',
    'headquarters',
    'geographic_focus',
    'sectors',
    'employee_count',
    'contact',
    'aum',
    'fund_raise',
    'check_size',
    'loan_types',
    'lender_archetype',
    'loan_terms',
    'lending_currency',
    'lending_channel',
    'underwriting',
    'risk_sharing',
    'portfolio_scale',
    'deal',
    'lp',
    'public_record',
    'impact_metric',
    'success_story',
    'news',
    'conference',
] as const
export type FundResearchField = (typeof FUND_RESEARCH_FIELDS)[number]

export const FUND_RESEARCH_FIELD_DETAILS: Record<
    FundResearchField,
    { label: string; group: FundResearchGroup; isList: boolean; isLinkOnly: boolean; weight: number; hint: string }
> = {
    summary: {
        label: 'Thesis',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'What the fund does and who it lends to, in one or two sentences.',
    },
    website_url: {
        label: 'Website',
        group: 'basics',
        isList: false,
        isLinkOnly: true,
        weight: 1,
        hint: "The fund's own website.",
    },
    linkedin_url: {
        label: 'LinkedIn',
        group: 'basics',
        isList: false,
        isLinkOnly: true,
        weight: 1,
        hint: "The fund's LinkedIn company page.",
    },
    social_account: {
        label: 'Other social accounts',
        group: 'basics',
        isList: true,
        isLinkOnly: true,
        weight: 0.5,
        hint: 'X/Twitter, YouTube, Facebook, Instagram and similar.',
    },
    year_established: {
        label: 'Year established',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'When the fund manager was founded.',
    },
    headquarters: {
        label: 'Headquarters',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'City and country of the head office.',
    },
    geographic_focus: {
        label: 'Geographic focus',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Countries and regions it lends in.',
    },
    sectors: {
        label: 'Sectors',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Agriculture, electrification, energy and so on.',
    },
    employee_count: {
        label: 'Team size',
        group: 'basics',
        isList: false,
        isLinkOnly: false,
        weight: 0.5,
        hint: 'Number of employees, or a headcount band such as 11-50.',
    },
    contact: {
        label: 'Contact details',
        group: 'basics',
        isList: true,
        isLinkOnly: false,
        weight: 0.5,
        hint: 'Email addresses, phone numbers, offices and contact pages the fund publishes.',
    },
    aum: {
        label: 'AUM',
        group: 'lending',
        isList: false,
        isLinkOnly: false,
        weight: 2,
        hint: 'Assets under management across all funds.',
    },
    fund_raise: {
        label: 'Fund raises',
        group: 'lending',
        isList: true,
        isLinkOnly: false,
        weight: 2,
        hint: 'Each fund it raised: name, size and when it closed.',
    },
    check_size: {
        label: 'Check size',
        group: 'lending',
        isList: false,
        isLinkOnly: false,
        weight: 2,
        hint: 'Preferred loan sizes: smallest to largest ticket.',
    },
    loan_types: {
        label: 'Loan types',
        group: 'lending',
        isList: false,
        isLinkOnly: false,
        weight: 2,
        hint: 'Working capital, project debt, term debt and so on.',
    },
    lender_archetype: {
        label: 'Lender type',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Climate private debt, generalist private credit, blended fund, digital lender, supply-chain platform, bank/NBFI, MFI or CDFI.',
    },
    loan_terms: {
        label: 'Loan terms',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Pricing (interest rate or range), tenor in months, and collateral they ask for.',
    },
    lending_currency: {
        label: 'Lending currency',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Whether loans are in local currency, hard currency (USD, EUR) or both.',
    },
    lending_channel: {
        label: 'Direct or on-lending',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Whether they lend to businesses directly or through local banks and other lenders.',
    },
    underwriting: {
        label: 'Underwriting',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'How they assess borrowers (cash flow, collateral, invoices/buyers, data) and origination partners (OEMs, co-ops, offtakers).',
    },
    risk_sharing: {
        label: 'First-loss & guarantees',
        group: 'model',
        isList: true,
        isLinkOnly: false,
        weight: 0.5,
        hint: 'First-loss capital, guarantees or catalytic tranches they already use, and from whom.',
    },
    portfolio_scale: {
        label: 'Portfolio scale',
        group: 'model',
        isList: false,
        isLinkOnly: false,
        weight: 1,
        hint: 'Number of borrowers or loans to date, and the portfolio outstanding.',
    },
    deal: {
        label: 'Published deals',
        group: 'track_record',
        isList: true,
        isLinkOnly: false,
        weight: 2,
        hint: 'Loans and investments it has announced.',
    },
    lp: {
        label: 'LPs and funders',
        group: 'track_record',
        isList: true,
        isLinkOnly: false,
        weight: 1,
        hint: 'Investors in its funds, from press releases and reports.',
    },
    public_record: {
        label: 'DFI & government records',
        group: 'track_record',
        isList: true,
        isLinkOnly: false,
        weight: 0,
        hint: 'Matches in public DFI and government lists of investments and grants.',
    },
    impact_metric: {
        label: 'Impact metrics',
        group: 'track_record',
        isList: true,
        isLinkOnly: false,
        weight: 1,
        hint: 'Published impact numbers (jobs, tCO2e, farmers reached…).',
    },
    success_story: {
        label: 'Success stories',
        group: 'track_record',
        isList: true,
        isLinkOnly: false,
        weight: 0.5,
        hint: 'Case studies of borrowers it has backed.',
    },
    news: {
        label: 'News & press releases',
        group: 'presence',
        isList: true,
        isLinkOnly: false,
        weight: 1,
        hint: 'Coverage and announcements.',
    },
    conference: {
        label: 'Conferences',
        group: 'presence',
        isList: true,
        isLinkOnly: false,
        weight: 0.5,
        hint: 'Events the team has spoken at or attended.',
    },
}

// Team data lives in its own tables but still counts toward completeness.
export const FUND_TEAM_COMPLETENESS = { principals: 2, work_history: 1 } as const

// The Due Diligence questions people track down (the AI may pre-fill from public sources).
export const FUND_DILIGENCE_QUESTIONS = [
    'default_rate',
    'recovery_and_npls',
    'loans_per_year',
    'deployment_capacity',
    'fx_risk',
    'technology',
    'time_to_close',
] as const
export type FundDiligenceQuestion = (typeof FUND_DILIGENCE_QUESTIONS)[number]

export const FUND_DILIGENCE_QUESTION_DETAILS: Record<FundDiligenceQuestion, { label: string; hint: string }> = {
    default_rate: {
        label: 'Default rate',
        hint: 'Historical default or write-off rate on their loans (and how they define default).',
    },
    recovery_and_npls: {
        label: 'Recovery rate & NPLs',
        hint: 'How much of defaulted loans they recover and when, non-performing loans and write-offs.',
    },
    deployment_capacity: {
        label: 'Deployment capacity',
        hint: 'How much they could lend over the next 12–24 months, and how fast they deploy today.',
    },
    loans_per_year: {
        label: 'Loans per year',
        hint: 'How many loans they make a year, and the portfolio size today.',
    },
    fx_risk: {
        label: 'FX risk',
        hint: 'How they handle currency risk: hard-currency loans, local currency, hedging (e.g. TCX).',
    },
    technology: {
        label: 'Technology',
        hint: 'Loan management, underwriting and monitoring systems they use.',
    },
    time_to_close: {
        label: 'Time to close',
        hint: 'How long from first contact to disbursing a loan.',
    },
}
