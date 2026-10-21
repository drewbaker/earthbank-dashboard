import {
    findFundManager,
    findFundManagerByDomain,
    findFundManagerByIdentity,
    listFundIdentities,
    updateFundManagerColumns,
} from '#server/database/fund-managers.ts'
import { addFund } from '#server/utils/funds/add-fund.ts'
import { approveFund } from '#server/utils/funds/approve.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import type { FundFitTag, FundStage } from '#shared/constants/funds.ts'
import { organizationNameKey, tidyOrganizationName, websiteDomain } from '#shared/funds/organization-names.ts'
import type { FundBoardImportResult } from '#shared/schemas/funds.ts'
import { focusCodesFromText } from '#shared/utils/geo-focus.ts'

// Notes imported from the board start with this line, so importing the same file again doesn't add
// them twice.
const BOARD_NOTES_HEADING = 'From the old fund board (Airtable):'

// Generic words dropped when matching names loosely ("AHL Venture Partners" = "AHL Ventures").
const GENERIC_NAME_WORDS = new Set([
    'capital',
    'venture',
    'ventures',
    'partners',
    'partner',
    'fund',
    'funds',
    'investment',
    'investments',
    'management',
    'group',
    'finance',
    'financial',
    'holdings',
    'impact',
])

const BOARD_STAGES: Record<string, FundStage> = {
    'new additions': 'new_addition',
    sourced: 'sourced',
    'in diligence': 'in_diligence',
    shortlisted: 'shortlisted',
    passed: 'passed',
}

const BOARD_FIT_TAGS: Record<string, FundFitTag> = {
    'too big — could come down-market': 'too_big_could_come_down_market',
    'worked example': 'worked_example',
    'fragmentation connector': 'fragmentation_connector',
    'adjacent market specialist': 'adjacent_market_specialist',
}

// Board columns copied into the team's notes, in this order, with the label shown for each.
const BOARD_NOTE_FIELDS: [column: string, label: string][] = [
    ['Fund Thesis', 'Thesis'],
    ['Archetype', 'Archetype'],
    ['Sector Focus', 'Sectors'],
    ['Geographic Focus', 'Geographic focus'],
    ['Instrument Type', 'Instruments'],
    ['Check Size Range', 'Check size'],
    ['AUM / Fund Size', 'AUM / fund size'],
    ['Year Established', 'Year established'],
    ['Primary Source(s)', 'Primary sources'],
    ['Research Notes / Flags', 'Notes / flags'],
    ['Portfolio Stats', 'Portfolio'],
    ['Lending Operations', 'Lending operations'],
    ['Fund Operations', 'Fund operations'],
    ['Needs — Self-Identified', 'Needs (self-identified)'],
    ['Needs — Inferred', 'Needs (inferred)'],
]

// Board columns that hold a JSON list of links ({ label, url }).
const BOARD_LINK_FIELDS: [column: string, label: string][] = [
    ['Fund Materials', 'Fund materials'],
    ['Impact Metrics Reports', 'Impact reports'],
]

/** One fund from the board, read from its record. */
export type BoardFund = {
    name: string
    websiteUrl: string | null
    stage: FundStage | null
    fitTag: FundFitTag | null
    focusCodes: string[]
    discoveryContext: string | null
    notes: string
}

type FundImportOutcome = FundBoardImportResult['funds'][number]

/**
 * Read the funds out of the old Airtable board's JSON export.
 *
 * Columns were free text, so each one is read leniently: anything missing or unreadable is left out.
 * Logos aren't imported (Airtable's file links expire).
 *
 * @param input.records - The export's records (`{ id, fields }`).
 * @returns One entry per record that has an organization name.
 */
export function readBoardFunds({ records }: { records: { id: string; fields: Record<string, unknown> }[] }) {
    const funds: BoardFund[] = []
    for (const { fields } of records) {
        const name = text({ value: fields['Organization Name'] })
        if (!name) {
            continue
        }
        const region = text({ value: fields['Region'] })
        const sectors = text({ value: fields['Sector Focus'] })
        funds.push({
            name: tidyOrganizationName({ name }),
            websiteUrl: websiteFrom({ value: fields['Website'] }),
            stage: BOARD_STAGES[text({ value: fields['Pipeline Stage'] })?.toLowerCase() ?? ''] ?? null,
            fitTag: BOARD_FIT_TAGS[text({ value: fields['Archetype'] })?.toLowerCase() ?? ''] ?? null,
            focusCodes: boardFocusCodes({ geographicFocus: text({ value: fields['Geographic Focus'] }), region }),
            discoveryContext:
                [region ? `Region: ${region}` : null, sectors ? `sectors: ${sectors}` : null]
                    .filter(Boolean)
                    .join('; ')
                    .slice(0, 500) || null,
            notes: boardNotes({ fields }),
        })
    }
    return funds
}

/**
 * Add the board's funds to the list and queue their research, without duplicates and without
 * overwriting anything a person entered.
 *
 * A fund already on the list (same name, same name without its parenthetical, or same website) gets
 * only what it's missing: a website, a stage past "New additions", a fit tag, a regional focus, and
 * the board's notes appended below the team's own. A pending or AI-archived spider find is approved,
 * since the team had chosen it on the board; a fund the team archived stays archived. New funds are
 * approved and queued for research ahead of the spider.
 *
 * @param input.funds - Funds read from the export.
 * @param input.importedById - The team member importing it.
 * @param input.now - Current time.
 * @returns What happened to each fund, with counts.
 */
export async function importBoardFunds({
    funds,
    importedById,
    now,
}: {
    funds: BoardFund[]
    importedById: string
    now: Date
}): Promise<FundBoardImportResult> {
    const outcomes: FundImportOutcome[] = []
    const seenKeys = new Set<string>()
    for (const fund of funds) {
        const nameKey = organizationNameKey({ name: fund.name })
        if (seenKeys.has(nameKey)) {
            outcomes.push({ name: fund.name, fund_id: null, outcome: 'skipped', changes: ['listed twice in the file'] })
            continue
        }
        seenKeys.add(nameKey)
        const existing = await findExistingFund({ name: fund.name, websiteUrl: fund.websiteUrl })
        outcomes.push(
            existing
                ? await fillExistingFund({ fund, fundManagerId: existing.id, importedById, now })
                : await addBoardFund({ fund, importedById, now }),
        )
    }
    const count = (outcome: FundImportOutcome['outcome']) => outcomes.filter(entry => entry.outcome === outcome).length
    return {
        added: count('added'),
        updated: count('updated'),
        unchanged: count('unchanged'),
        left_archived: count('left_archived'),
        skipped: count('skipped'),
        funds: outcomes,
    }
}

/**
 * Find a fund already on the list (archived ones included) under the board's name, the name without
 * a parenthetical ("Arq Capital (ARQ SME BDC)" → "Arq Capital"), or its website.
 *
 * @param input.name - The board's name.
 * @param input.websiteUrl - The board's website, if any.
 * @returns The fund row, or null.
 */
async function findExistingFund({ name, websiteUrl }: { name: string; websiteUrl: string | null }) {
    const domain = websiteDomain({ url: websiteUrl })
    const byName = await findFundManagerByIdentity({ nameKey: organizationNameKey({ name }), websiteDomain: domain })
    if (byName) {
        return byName
    }
    const withoutParenthetical = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
    if (withoutParenthetical && withoutParenthetical !== name) {
        const byShortName = await findFundManagerByIdentity({
            nameKey: organizationNameKey({ name: withoutParenthetical }),
            websiteDomain: null,
        })
        if (byShortName) {
            return byShortName
        }
    }
    // Last, the distinctive words alone, only when exactly one fund on the list shares them.
    const coreKey = coreNameKey({ nameKey: organizationNameKey({ name: withoutParenthetical || name }) })
    if (coreKey.length < 3) {
        return null
    }
    const matches = (await listFundIdentities()).filter(fund => coreNameKey({ nameKey: fund.name_key }) === coreKey)
    return matches.length === 1 ? findFundManager({ fundManagerId: matches[0]!.id }) : null
}

/**
 * A name key without generic words, for loose matching.
 *
 * @param input.nameKey - An organization name key.
 * @returns The distinctive words, e.g. "ahl" for "ahl venture partners".
 */
function coreNameKey({ nameKey }: { nameKey: string }) {
    return nameKey
        .split(' ')
        .filter(word => !GENERIC_NAME_WORDS.has(word))
        .join(' ')
}

/**
 * Add a board fund that isn't on the list yet, approved, with the board's fields, and queue its research.
 *
 * @param input.fund - The board fund.
 * @param input.importedById - The team member importing it.
 * @param input.now - Current time.
 * @returns What happened.
 */
async function addBoardFund({ fund, importedById, now }: { fund: BoardFund; importedById: string; now: Date }) {
    const { fund: created } = await addFund({
        name: fund.name,
        websiteUrl: fund.websiteUrl,
        discoveryContext: fund.discoveryContext,
        origin: 'board_import',
        addedById: importedById,
        isNameChecked: true,
        now,
    })
    await updateFundManagerColumns({
        fundManagerId: created.id,
        data: {
            stage: fund.stage ?? undefined,
            fit_tags: fund.fitTag ? [fund.fitTag] : undefined,
            notes: fund.notes || undefined,
            team_focus_areas: fund.focusCodes.length ? fund.focusCodes : undefined,
            focus_areas: fund.focusCodes.length ? fund.focusCodes : undefined,
        },
    })
    return {
        name: fund.name,
        fund_id: created.id,
        outcome: 'added' as const,
        changes: ['added', 'queued for research'],
    }
}

/**
 * Fill in what an existing fund is missing from the board, approve it if it's still pending, and
 * queue research it never had. Never replaces anything a person set.
 *
 * @param input.fund - The board fund.
 * @param input.fundManagerId - The matching fund on the list.
 * @param input.importedById - The team member importing it.
 * @param input.now - Current time.
 * @returns What happened.
 */
async function fillExistingFund({
    fund,
    fundManagerId,
    importedById,
    now,
}: {
    fund: BoardFund
    fundManagerId: string
    importedById: string
    now: Date
}): Promise<FundImportOutcome> {
    const row = await findFundManager({ fundManagerId })
    if (!row) {
        return { name: fund.name, fund_id: null, outcome: 'skipped', changes: ['not found'] }
    }
    if (row.archived_at && !row.screened_out_at) {
        return { name: row.name, fund_id: row.id, outcome: 'left_archived', changes: ['archived by the team'] }
    }
    const changes: string[] = []
    const data: Parameters<typeof updateFundManagerColumns>[0]['data'] = {}
    if (row.screened_out_at) {
        // The AI screened it out, but the team had chosen it on the board.
        data.archived_at = null
        data.screened_out_at = null
        changes.push('restored from the AI screen')
    }
    const domain = websiteDomain({ url: fund.websiteUrl })
    if (!row.website_url && domain && !(await findFundManagerByDomain({ websiteDomain: domain }))) {
        data.website_url = fund.websiteUrl
        data.website_domain = domain
        changes.push('website')
    }
    if (fund.stage && fund.stage !== 'new_addition' && row.stage === 'new_addition') {
        data.stage = fund.stage
        changes.push('stage')
    }
    const fitTags = Array.isArray(row.fit_tags) ? row.fit_tags : []
    if (fund.fitTag && fitTags.length === 0) {
        data.fit_tags = [fund.fitTag]
        changes.push('fit tag')
    }
    if (fund.focusCodes.length && !Array.isArray(row.team_focus_areas)) {
        data.team_focus_areas = fund.focusCodes
        changes.push('regional focus')
    }
    if (fund.notes && !row.notes?.includes(BOARD_NOTES_HEADING)) {
        data.notes = row.notes ? `${row.notes.trimEnd()}\n\n${fund.notes}` : fund.notes
        changes.push('notes')
    }
    if (!row.discovery_context && fund.discoveryContext) {
        data.discovery_context = fund.discoveryContext
    }
    if (Object.keys(data).length > 0) {
        await updateFundManagerColumns({ fundManagerId, data })
    }
    if (data.team_focus_areas) {
        // The team's focus replaces research's in the list, filters and map.
        await refreshFundResearchValues({ fundManagerId })
    }
    if (row.approval_status === 'pending') {
        await approveFund({ fundManagerId, approvedById: importedById, now })
        changes.push(row.research_status === 'awaiting_approval' ? 'approved and queued for research' : 'approved')
    }
    return { name: row.name, fund_id: row.id, outcome: changes.length ? 'updated' : 'unchanged', changes }
}

/**
 * The board's free-text columns as notes for the team, under a heading.
 *
 * @param input.fields - The record's fields.
 * @returns The notes, or an empty string when the record has none.
 */
function boardNotes({ fields }: { fields: Record<string, unknown> }) {
    const lines = BOARD_NOTE_FIELDS.flatMap(([column, label]) => {
        const value = text({ value: fields[column] })
        return value ? [`${label}: ${value}`] : []
    })
    const contact = [text({ value: fields['Contact Name'] }), text({ value: fields['Contact Position'] })]
        .filter(Boolean)
        .join(', ')
    if (contact) {
        lines.push(`Contact: ${contact}`)
    }
    for (const [column, label] of BOARD_LINK_FIELDS) {
        const links = boardLinks({ value: fields[column] })
        if (links.length) {
            lines.push(`${label}: ${links.join('; ')}`)
        }
    }
    return lines.length ? [BOARD_NOTES_HEADING, ...lines].join('\n') : ''
}

/**
 * A board link column (a JSON list of `{ label, url }`) as "label <url>" entries.
 *
 * @param input.value - The column value.
 * @returns The links; none when the value isn't a readable list.
 */
function boardLinks({ value }: { value: unknown }) {
    let parsed: unknown = value
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value)
        } catch {
            return []
        }
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    return parsed.flatMap(entry => {
        const link = entry as { label?: unknown; url?: unknown }
        const url = typeof link.url === 'string' && /^https?:\/\//i.test(link.url) ? link.url : null
        return url ? [`${typeof link.label === 'string' ? link.label : 'Link'} <${url}>`] : []
    })
}

/**
 * Focus codes from the board: its geographic focus when that names countries or regions, else its
 * broader region column.
 *
 * @param input.geographicFocus - The free-text geographic focus.
 * @param input.region - The region column.
 * @returns Focus codes.
 */
function boardFocusCodes({ geographicFocus, region }: { geographicFocus: string | null; region: string | null }) {
    // "Kenya (Nairobi HQ)" → "Kenya".
    const focus = focusCodesFromText({ text: geographicFocus?.replace(/\([^)]*\)/g, '') ?? null }).codes
    return focus.length ? focus : focusCodesFromText({ text: region }).codes
}

/**
 * A website column as a full URL.
 *
 * @param input.value - The column value.
 * @returns The URL, or null when it isn't a web address.
 */
function websiteFrom({ value }: { value: unknown }) {
    const raw = text({ value })
    if (!raw) {
        return null
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return websiteDomain({ url }) ? url : null
}

/**
 * A column value as trimmed text.
 *
 * @param input.value - The column value.
 * @returns The text, or null when empty or not text.
 */
function text({ value }: { value: unknown }) {
    if (typeof value === 'number') {
        return String(value)
    }
    return typeof value === 'string' && value.trim() ? value.trim() : null
}
