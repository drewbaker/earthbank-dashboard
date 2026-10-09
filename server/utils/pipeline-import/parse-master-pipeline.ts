import type {
    FunderKind,
    FunderTier,
    GoalType,
    OpportunityStage,
    RelationshipStatus,
} from '#shared/constants/pipeline.ts'
import { normalizeEmailAddress } from '#shared/utils/email-addresses.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

export type SheetCell = string | number | boolean | Date | null | undefined

export type ParsedContact = { name: string; title: string | null; email: string | null; notes: string | null }

export type ParsedOpportunity = {
    goalType: GoalType
    stage: OpportunityStage
    amountCents: number | null
    nextStep: string | null
}

export type ParsedFunder = {
    name: string
    nameKey: string
    kind: FunderKind
    tier: FunderTier | null
    relationshipStatus: RelationshipStatus
    geoFocus: string | null
    potentialSize: string | null
    materialsSent: boolean
    lastContactAt: string | null
    lastContactNote: string | null
    notes: string | null
    contacts: ParsedContact[]
    opportunities: ParsedOpportunity[]
    sheetRows: number[]
}

export type ParsedMasterPipeline = { funders: ParsedFunder[]; warnings: string[] }

const STATUS_MAP: Record<string, { relationship: RelationshipStatus; stage: OpportunityStage | null }> = {
    committed: { relationship: 'committed', stage: 'committed' },
    advanced: { relationship: 'advanced', stage: 'due_diligence' },
    active: { relationship: 'active', stage: 'in_discussion' },
    early: { relationship: 'early', stage: 'identified' },
    'no contact': { relationship: 'no_contact', stage: null },
    dead: { relationship: 'dead', stage: 'lost' },
}

// Organizations whose kind isn't "foundation". Anything not listed defaults to foundation and can be
// corrected in the app.
const KNOWN_KINDS: Record<string, FunderKind> = {
    'bii british int l investment': 'dfi',
    fmo: 'dfi',
    'nordic development fund': 'dfi',
    findevcanada: 'dfi',
    'dutch good growth fund': 'dfi',
    'fsd africa': 'dfi',
    norad: 'government',
    sida: 'government',
    'sdc switzerland': 'government',
    'monetary authority of singapore': 'government',
    'andrew bredenkamp': 'individual',
    'mackenzie scott': 'individual',
    goldman: 'corporate',
    googlex: 'corporate',
    'builders vision': 'other',
    'blue haven initiative': 'other',
    'rainier climate': 'other',
    tempest: 'other',
    blue7: 'other',
    'schmidt futures': 'other',
    gates: 'foundation',
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const HEADER_ALIASES: Record<string, keyof ColumnIndexes> = {
    organization: 'organization',
    'key contact(s)': 'contacts',
    'email(s)': 'emails',
    'geo focus': 'geoFocus',
    'tiered priority': 'tier',
    'potential size': 'potentialSize',
    status: 'status',
    'design / grant $': 'designGrantAmount',
    'potential follow-on $': 'followOnAmount',
    'eb 3-pager': 'materials',
    'last contact': 'lastContact',
    'notes — momentum & next step': 'notes',
}

type ColumnIndexes = {
    organization: number
    contacts: number
    emails: number
    geoFocus: number
    tier: number
    potentialSize: number
    status: number
    designGrantAmount: number
    followOnAmount: number
    materials: number
    lastContact: number
    notes: number
}

/**
 * Parse the "Master Pipeline" sheet into funders, merging duplicate organizations.
 *
 * Pure: no database access, so it's unit-tested with plain rows.
 *
 * @param input.rows - Every row of the sheet, as read by read-excel-file (first row = sheet row 1).
 * @returns Parsed funders in sheet order, and warnings for anything skipped or guessed.
 */
export function parseMasterPipeline({ rows }: { rows: SheetCell[][] }): ParsedMasterPipeline {
    const warnings: string[] = []
    const headerIndex = rows.findIndex(row => cellText({ cell: row[0] })?.toLowerCase() === 'organization')
    if (headerIndex === -1) {
        throw new Error('Could not find the header row (a row starting with "Organization").')
    }
    const columns = mapColumns({ header: rows[headerIndex]! })
    const byKey = new Map<string, ParsedFunder>()
    let pastTotal = false

    for (let index = headerIndex + 1; index < rows.length; index++) {
        const row = rows[index]!
        const name = cellText({ cell: row[columns.organization] })
        if (!name) {
            continue
        }
        if (/^pipeline total/i.test(name)) {
            pastTotal = true
            continue
        }
        const funder = pastTotal
            ? parseProspectRow({ name, sheetRow: index + 1 })
            : parseFunderRow({ row, columns, name, sheetRow: index + 1, warnings })
        const existing = byKey.get(funder.nameKey)
        if (existing) {
            warnings.push(`Merged duplicate "${name}" (rows ${existing.sheetRows.join(', ')} and ${index + 1}).`)
            byKey.set(funder.nameKey, mergeFunders({ first: existing, second: funder }))
        } else {
            byKey.set(funder.nameKey, funder)
        }
    }
    return { funders: [...byKey.values()], warnings }
}

/**
 * Parse one funder row.
 *
 * @param input.row - The row's cells.
 * @param input.columns - Column positions.
 * @param input.name - Organization name.
 * @param input.sheetRow - 1-based sheet row number, for warnings.
 * @param input.warnings - Collects anything guessed or skipped.
 * @returns The parsed funder.
 */
function parseFunderRow({
    row,
    columns,
    name,
    sheetRow,
    warnings,
}: {
    row: SheetCell[]
    columns: ColumnIndexes
    name: string
    sheetRow: number
    warnings: string[]
}): ParsedFunder {
    const statusText = cellText({ cell: row[columns.status] })?.toLowerCase() ?? 'no contact'
    const status = STATUS_MAP[statusText]
    if (!status) {
        warnings.push(`Row ${sheetRow}: unknown status "${statusText}", treated as No Contact.`)
    }
    const notes = cellText({ cell: row[columns.notes] })
    const nextStep = notes?.match(/NEXT:\s*(.+)$/s)?.[1]?.trim() ?? null
    const { contacts, funderNote } = parseContacts({
        namesText: cellText({ cell: row[columns.contacts] }),
        emailsText: cellText({ cell: row[columns.emails] }),
    })
    const lastContactText = cellText({ cell: row[columns.lastContact] })
    const stage = (status ?? STATUS_MAP['no contact']!).stage

    const opportunities: ParsedOpportunity[] = []
    const designGrantCents = amountCents({ cell: row[columns.designGrantAmount] })
    const followOnCents = amountCents({ cell: row[columns.followOnAmount] })
    const potentialSize = cellText({ cell: row[columns.potentialSize] })
    const isDesignGrantProspect = /design grant/i.test(potentialSize ?? '') && stage !== null && stage !== 'lost'
    if (stage && (designGrantCents || isDesignGrantProspect)) {
        // "Design Grant Only" funders in conversation get a design-grant opportunity even before a $ figure.
        opportunities.push({ goalType: 'design_grant', stage, amountCents: designGrantCents, nextStep })
    }
    if (stage && followOnCents) {
        // Follow-on money goes into the lending structure; it's still early even when the grant is advanced.
        const followOnStage = stage === 'lost' ? 'lost' : stage === 'committed' ? 'in_discussion' : 'identified'
        opportunities.push({
            goalType: 'lending_capital',
            stage: followOnStage,
            amountCents: followOnCents,
            nextStep: null,
        })
    }

    const tierText = cellText({ cell: row[columns.tier] })?.toLowerCase()
    return {
        name,
        nameKey: funderNameKey({ name }),
        kind: KNOWN_KINDS[funderNameKey({ name })] ?? 'foundation',
        tier: tierText && /^t[1-4]$/.test(tierText) ? (tierText as FunderTier) : null,
        relationshipStatus: (status ?? STATUS_MAP['no contact']!).relationship,
        geoFocus: cellText({ cell: row[columns.geoFocus] }),
        potentialSize,
        materialsSent: cellText({ cell: row[columns.materials] })?.toUpperCase() === 'Y',
        lastContactAt: latestDate({ text: lastContactText }),
        lastContactNote: lastContactText,
        notes: [notes, funderNote].filter(Boolean).join('\n\n') || null,
        contacts,
        opportunities,
        sheetRows: [sheetRow],
    }
}

/**
 * Names listed under "PIPELINE TOTAL" with no other details: prospects to research.
 *
 * @param input.name - Organization name.
 * @param input.sheetRow - 1-based sheet row number.
 * @returns A bare prospect funder.
 */
function parseProspectRow({ name, sheetRow }: { name: string; sheetRow: number }): ParsedFunder {
    return {
        name,
        nameKey: funderNameKey({ name }),
        kind: KNOWN_KINDS[funderNameKey({ name })] ?? 'foundation',
        tier: null,
        relationshipStatus: 'no_contact',
        geoFocus: null,
        potentialSize: null,
        materialsSent: false,
        lastContactAt: null,
        lastContactNote: null,
        notes: 'Listed below the pipeline total in the spreadsheet; no details yet.',
        contacts: [],
        opportunities: [],
        sheetRows: [sheetRow],
    }
}

/**
 * Pair the "Key Contact(s)" names with the "Email(s)" addresses.
 *
 * Names are split on `;` and `,` outside parentheses. "(+ A, B)" adds people; other parentheticals
 * become the contact's notes, and a cell that is only a parenthetical becomes a funder note. Emails
 * are matched to names by first/last name in the address, then by position; extra emails become
 * contacts named after the address.
 *
 * @param input.namesText - The contacts cell.
 * @param input.emailsText - The emails cell.
 * @returns Contacts, plus a note for the funder when the cell only described outreach.
 */
export function parseContacts({ namesText, emailsText }: { namesText: string | null; emailsText: string | null }) {
    const people: { name: string; notes: string | null }[] = []
    let funderNote: string | null = null

    for (const segment of splitOutsideParentheses({ text: namesText ?? '' })) {
        const parenthetical = segment.match(/\(([^)]*)\)/)?.[1]?.trim() ?? null
        const name = segment.replace(/\([^)]*\)/g, '').trim()
        if (!name || name === '—' || name === '-') {
            funderNote = parenthetical ?? funderNote
            continue
        }
        if (parenthetical?.startsWith('+')) {
            people.push({ name, notes: null })
            for (const extra of parenthetical.slice(1).split(',')) {
                if (extra.trim()) {
                    people.push({ name: extra.trim(), notes: null })
                }
            }
        } else {
            people.push({ name, notes: parenthetical })
        }
    }

    const emails = (emailsText ?? '')
        .split(/[;,\s]+/)
        .map(part => normalizeEmailAddress({ email: part }))
        .filter((email): email is string => email !== null)
    const unmatchedEmails = [...new Set(emails)]
    // "Paula Pagniez / CEO" is a name and a title.
    const contacts: ParsedContact[] = people.map(person => {
        const [name, title] = person.name.split(/\s+\/\s+/)
        return { name: name!.trim(), title: title?.trim() || null, email: null, notes: person.notes }
    })

    for (const contact of contacts) {
        const nameParts = contact.name
            .toLowerCase()
            .split(/[\s./]+/)
            .map(part => part.replace(/[^a-z]/g, ''))
            .filter(part => part.length >= 3)
        const match = unmatchedEmails.find(email => nameParts.some(part => email.split('@')[0]!.includes(part)))
        if (match) {
            contact.email = match
            unmatchedEmails.splice(unmatchedEmails.indexOf(match), 1)
        }
    }
    for (const contact of contacts) {
        if (!contact.email && unmatchedEmails.length > 0 && !isRoleOnly({ name: contact.name })) {
            contact.email = unmatchedEmails.shift()!
        }
    }
    for (const email of unmatchedEmails) {
        contacts.push({ name: nameFromEmail({ email }), title: null, email, notes: null })
    }
    return { contacts: contacts.filter(contact => !isRoleOnly({ name: contact.name }) || contact.email), funderNote }
}

/**
 * The most recent date mentioned in a "Last Contact" cell.
 *
 * Understands "Jun 2, 2026", "Jun 2026" (first of the month) and several dates in one cell
 * ("Jun 24, 2026 (in-person); Jul 8, 2026 (email)"). A trailing day without a year
 * ("meeting Jul 20") takes the year of the date before it.
 *
 * @param input.text - The cell text.
 * @returns The latest date as YYYY-MM-DD, or null when there is none.
 */
export function latestDate({ text }: { text: string | null }) {
    if (!text) {
        return null
    }
    const dates: string[] = []
    let lastYear: number | null = null
    const pattern =
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:(\d{1,2})(?!\d)(?:st|nd|rd|th)?,?\s*)?(\d{4})?/gi
    for (const match of text.matchAll(pattern)) {
        const month = MONTHS.indexOf(match[1]!.toLowerCase())
        const day = match[2] ? Number(match[2]) : 1
        const year: number | null = match[3] ? Number(match[3]) : lastYear
        if (year === null || (!match[2] && !match[3])) {
            continue
        }
        lastYear = year
        dates.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10))
    }
    return dates.sort().at(-1) ?? null
}

/**
 * Combine two rows for the same organization. The higher-priority row wins field by field; the
 * other fills gaps. Contacts are unioned by email/name; opportunities by goal.
 *
 * @param input.first - Row seen first.
 * @param input.second - Duplicate row.
 * @returns The merged funder.
 */
function mergeFunders({ first, second }: { first: ParsedFunder; second: ParsedFunder }): ParsedFunder {
    const tierRank = (funder: ParsedFunder) => (funder.tier ? Number(funder.tier.slice(1)) : 9)
    const [primary, secondary] = tierRank(second) < tierRank(first) ? [second, first] : [first, second]
    const contacts = [...primary.contacts]
    for (const contact of secondary.contacts) {
        const isKnown = contacts.some(known =>
            contact.email ? known.email === contact.email : known.name.toLowerCase() === contact.name.toLowerCase(),
        )
        if (!isKnown) {
            contacts.push(contact)
        }
    }
    const opportunities = [...primary.opportunities]
    for (const opportunity of secondary.opportunities) {
        if (!opportunities.some(known => known.goalType === opportunity.goalType)) {
            opportunities.push(opportunity)
        }
    }
    return {
        ...primary,
        geoFocus: primary.geoFocus ?? secondary.geoFocus,
        potentialSize: primary.potentialSize ?? secondary.potentialSize,
        materialsSent: primary.materialsSent || secondary.materialsSent,
        lastContactAt: [primary.lastContactAt, secondary.lastContactAt].filter(Boolean).sort().at(-1) ?? null,
        lastContactNote: primary.lastContactNote ?? secondary.lastContactNote,
        notes: primary.notes ?? secondary.notes,
        contacts,
        opportunities,
        sheetRows: [...first.sheetRows, ...second.sheetRows].sort((a, b) => a - b),
    }
}

/**
 * Find each known column by its header text.
 *
 * @param input.header - The header row.
 * @returns Column positions.
 * @throws Error when a required column is missing.
 */
function mapColumns({ header }: { header: SheetCell[] }) {
    const columns: Partial<ColumnIndexes> = {}
    header.forEach((cell, index) => {
        const key = HEADER_ALIASES[cellText({ cell })?.toLowerCase().replace(/\s+/g, ' ') ?? '']
        if (key) {
            columns[key] = index
        }
    })
    const missing = Object.values(HEADER_ALIASES).filter(key => columns[key] === undefined)
    if (missing.length > 0) {
        throw new Error(`Missing columns in the header row: ${missing.join(', ')}`)
    }
    return columns as ColumnIndexes
}

/**
 * Split on `;` and `,` that are not inside parentheses.
 *
 * @param input.text - Cell text.
 * @returns Trimmed, non-empty segments.
 */
function splitOutsideParentheses({ text }: { text: string }) {
    const segments: string[] = []
    let depth = 0
    let current = ''
    for (const character of text) {
        if (character === '(') depth++
        if (character === ')') depth = Math.max(0, depth - 1)
        if ((character === ';' || character === ',') && depth === 0) {
            segments.push(current)
            current = ''
        } else {
            current += character
        }
    }
    segments.push(current)
    return segments.map(segment => segment.trim()).filter(Boolean)
}

/**
 * A readable name from an address: `emmanuel.kalia@x.org` → "Emmanuel Kalia".
 *
 * @param input.email - Normalized email.
 * @returns A display name.
 */
function nameFromEmail({ email }: { email: string }) {
    return email
        .split('@')[0]!
        .split(/[._-]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

/**
 * Whether a "name" is just a role ("CEO") rather than a person.
 *
 * @param input.name - The name text.
 * @returns True for bare roles.
 */
function isRoleOnly({ name }: { name: string }) {
    return /^(ceo|cfo|coo|cio|president|director|founder|team)$/i.test(name.trim())
}

/**
 * Text content of a cell, trimmed; empty and dash placeholders become null.
 *
 * @param input.cell - The cell value.
 * @returns The text, or null.
 */
function cellText({ cell }: { cell: SheetCell }) {
    if (cell === null || cell === undefined) {
        return null
    }
    const text = cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim()
    return text === '' || text === '—' || text === '-' ? null : text
}

/**
 * A positive dollar amount cell as cents.
 *
 * @param input.cell - Number of dollars, or text like "N/A".
 * @returns Cents, or null when empty, zero or not a number.
 */
function amountCents({ cell }: { cell: SheetCell }) {
    const dollars = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/[$,\s]/g, ''))
    return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null
}
