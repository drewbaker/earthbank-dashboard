import type { H3Event } from 'h3'
import { getCookie, setCookie } from 'h3'
import type { ShareLink as ShareLinkRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { listGoalsWithOpportunities } from '#server/database/goals.ts'
import { listSharedPipelineRows } from '#server/database/opportunities.ts'
import { config } from '#server/utils/config.ts'
import { decryptSecret, signValue, verifySignedValue } from '#server/utils/crypto.ts'
import { centsToNumber, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import { serializeGoal } from '#server/utils/serializers/goals.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import type { SharedAsk, SharedPipeline, ShareLink } from '#shared/schemas/index.ts'
import { ShareSections } from '#shared/schemas/index.ts'
import { focusCodesFromText, geoFocusLabel } from '#shared/utils/geo-focus.ts'

// After the right password, the browser can view the page for this long before asking again.
const UNLOCK_HOURS = 12

// Wrong passwords allowed per link before it pauses, and for how long.
const MAX_FAILED_ATTEMPTS = 10
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

/**
 * The page funders open.
 *
 * @param input.token - The secret in the link.
 * @returns The full URL.
 */
export function shareUrl({ token }: { token: string }) {
    return `${config.appUrl}/share/${token}`
}

/**
 * A link as the team sees it in Settings → Sharing, password included (it's for sending to funders).
 *
 * @param input.link - The row with its creator.
 * @returns The API shape.
 */
export function serializeShareLink({ link }: { link: ShareLinkRow & { created_by: UserRow | null } }): ShareLink {
    const token = decryptSecret({ encrypted: link.token_encrypted })
    return {
        id: link.id,
        label: link.label,
        url: token ? shareUrl({ token }) : '',
        has_password: link.password_hash !== null,
        password: link.password_encrypted ? decryptSecret({ encrypted: link.password_encrypted }) : null,
        show_next_steps: link.show_next_steps,
        sections: readShareSections({ value: link.sections }),
        created_by: serializeUserSummary({ user: link.created_by }),
        last_viewed_at: toIsoDateTime({ date: link.last_viewed_at }),
        created_at: link.created_at.toISOString(),
    }
}

/**
 * A link's stored section settings, with anything missing (or unreadable) shown.
 *
 * @param input.value - The stored JSON, or null.
 * @returns Every section's on/off.
 */
export function readShareSections({ value }: { value: unknown }) {
    const parsed = ShareSections.safeParse(value ?? {})
    return parsed.success ? parsed.data : ShareSections.parse({})
}

/**
 * Remember in this browser that the right password was given for a link.
 *
 * @param input.event - The request.
 * @param input.shareLinkId - The link.
 * @param input.now - The current time.
 * @returns Nothing.
 */
export function rememberUnlockedShareLink({
    event,
    shareLinkId,
    now = new Date(),
}: {
    event: H3Event
    shareLinkId: string
    now?: Date
}) {
    const expiresAt = now.getTime() + UNLOCK_HOURS * 60 * 60 * 1000
    setCookie(event, unlockCookieName({ shareLinkId }), signValue({ value: `${shareLinkId}.${expiresAt}` }), {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        path: '/',
        maxAge: UNLOCK_HOURS * 60 * 60,
    })
}

/**
 * Whether this browser already gave the right password for a link.
 *
 * @param input.event - The request.
 * @param input.shareLinkId - The link.
 * @param input.now - The current time.
 * @returns True while the unlock is still valid.
 */
export function isShareLinkUnlocked({
    event,
    shareLinkId,
    now = new Date(),
}: {
    event: H3Event
    shareLinkId: string
    now?: Date
}) {
    const signed = getCookie(event, unlockCookieName({ shareLinkId }))
    const value = signed ? verifySignedValue({ signed }) : null
    if (!value) {
        return false
    }
    const [linkId, expiresAt] = value.split('.')
    return linkId === shareLinkId && Number(expiresAt) > now.getTime()
}

/**
 * Cookie name for one link's unlock, so links don't unlock each other.
 *
 * @param input.shareLinkId - The link.
 * @returns The cookie name.
 */
function unlockCookieName({ shareLinkId }: { shareLinkId: string }) {
    return `earthbank_dashboard_share_${shareLinkId}`
}

const failedAttempts = new Map<string, { count: number; resetsAt: number }>()

/**
 * Whether a link has had too many wrong passwords lately (kept in memory: the app runs as one
 * process, and a restart clearing it is harmless).
 *
 * @param input.shareLinkId - The link.
 * @param input.now - The current time in ms.
 * @returns True when further attempts should wait.
 */
export function isShareLinkPaused({ shareLinkId, now = Date.now() }: { shareLinkId: string; now?: number }) {
    const entry = failedAttempts.get(shareLinkId)
    return Boolean(entry && entry.resetsAt > now && entry.count >= MAX_FAILED_ATTEMPTS)
}

/**
 * Count a wrong password.
 *
 * @param input.shareLinkId - The link.
 * @param input.now - The current time in ms.
 * @returns Nothing.
 */
export function recordFailedShareLinkAttempt({ shareLinkId, now = Date.now() }: { shareLinkId: string; now?: number }) {
    const entry = failedAttempts.get(shareLinkId)
    if (!entry || entry.resetsAt <= now) {
        failedAttempts.set(shareLinkId, { count: 1, resetsAt: now + ATTEMPT_WINDOW_MS })
    } else {
        entry.count++
    }
}

/**
 * What the share page shows: every live ask, split into design grants (design grants and OpEx) and
 * lending capital, with only fields that are safe for funders to see. Data for parts the link hides
 * isn't sent at all (contacts only with the table, focus codes only with the map, and so on).
 *
 * @param input.showNextSteps - Include a short next step for each ask (in the table).
 * @param input.sections - Which parts of the page the link shows.
 * @param input.now - When the summary was made.
 * @returns The page data.
 */
export async function buildSharedPipeline({
    showNextSteps,
    sections = ShareSections.parse({}),
    now = new Date(),
}: {
    showNextSteps: boolean
    sections?: ShareSections
    now?: Date
}): Promise<SharedPipeline> {
    const [rows, goalRows, stageProbabilities] = await Promise.all([
        listSharedPipelineRows(),
        listGoalsWithOpportunities(),
        readStageProbabilities(),
    ])
    // Same stats boxes as Pipeline (OpEx hidden there too); internal goal notes stay private.
    const goals = goalRows
        .map(goal => ({ ...serializeGoal({ goal, stageProbabilities }), notes: null }))
        .filter(goal => goal.type !== 'opex')
    const toAsk = (row: (typeof rows)[number]): SharedAsk => ({
        organization: row.funder.name,
        contacts: sections.table
            ? [...new Set(row.funder.contacts.map(contact => contact.name.trim()).filter(Boolean))]
            : [],
        geo_focus: sections.table
            ? geoFocusNames({ focusAreas: row.focus_areas, funderGeoFocus: row.funder.geo_focus })
            : [],
        amount_cents: centsToNumber({ cents: row.amount_cents }),
        stage: row.stage as OpportunityStage,
        focus_areas: sections.map
            ? focusCodes({ focusAreas: row.focus_areas, funderGeoFocus: row.funder.geo_focus })
            : [],
        next_step: sections.table && showNextSteps ? shortNextStep({ text: row.next_step }) : null,
    })
    return {
        title: 'Earth Bank funding pipeline',
        updated_at: now.toISOString(),
        sections,
        show_next_steps: showNextSteps,
        design_grants: sections.design_grants ? rows.filter(row => row.goal.type !== 'lending_capital').map(toAsk) : [],
        lending_capital: sections.lending_capital
            ? rows.filter(row => row.goal.type === 'lending_capital').map(toAsk)
            : [],
        design_grant_goals:
            sections.stats && sections.design_grants ? goals.filter(goal => goal.type === 'design_grant') : [],
        lending_capital_goals:
            sections.stats && sections.lending_capital ? goals.filter(goal => goal.type === 'lending_capital') : [],
    }
}

/**
 * Names for an ask's geographic focus, falling back to the funder's spreadsheet text.
 *
 * @param input.focusAreas - The ask's focus codes (JSON column).
 * @param input.funderGeoFocus - The funder's free-text geo focus.
 * @returns Names such as ["East Africa", "India"].
 */
function geoFocusNames({ focusAreas, funderGeoFocus }: { focusAreas: unknown; funderGeoFocus: string | null }) {
    return focusCodes({ focusAreas, funderGeoFocus }).map(code => geoFocusLabel({ code }))
}

/**
 * An ask's focus codes, falling back to the funder's spreadsheet text.
 *
 * @param input.focusAreas - The ask's focus codes (JSON column).
 * @param input.funderGeoFocus - The funder's free-text geo focus.
 * @returns Codes such as ["region:eastern_africa", "IN", "global"].
 */
function focusCodes({ focusAreas, funderGeoFocus }: { focusAreas: unknown; funderGeoFocus: string | null }) {
    const codes = Array.isArray(focusAreas) && focusAreas.length > 0 ? (focusAreas as string[]) : null
    return codes ?? focusCodesFromText({ text: funderGeoFocus }).codes
}

const NEXT_STEP_MAX_CHARS = 140

/**
 * The first sentence of a next step, kept short for the funder-facing table.
 *
 * @param input.text - The full next step.
 * @returns A short version, or null when empty.
 */
export function shortNextStep({ text }: { text: string | null }) {
    const trimmed = text?.trim()
    if (!trimmed) {
        return null
    }
    const firstSentence = trimmed.split(/(?<=[.;!?])\s+/)[0]!.replace(/[;,:]\s*$/, '')
    if (firstSentence.length <= NEXT_STEP_MAX_CHARS) {
        return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1)
    }
    const cut = firstSentence.slice(0, NEXT_STEP_MAX_CHARS)
    return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`
}
