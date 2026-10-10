import { latestManualChangeAt } from '#server/database/change-events.ts'
import {
    createEmailEvidence,
    findProcessedMessageIds,
    linkEmailEvidenceToFunder,
} from '#server/database/email-evidence.ts'
import { findFunderByNameKey } from '#server/database/funders.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { CLASSIFY_EMAIL_INSTRUCTIONS, DRAFT_FUNDER_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import type { EmailClassification } from '#server/utils/ai/schemas.ts'
import { DraftFunderProposal, EmailClassification as EmailClassificationSchema } from '#server/utils/ai/schemas.ts'
import type { ChangeValue } from '#server/utils/change-events.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { config } from '#server/utils/config.ts'
import { addContactToFunder } from '#server/utils/contacts.ts'
import { todayDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { createFunderWithDetails, loadFunderDetail } from '#server/utils/funders.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import type { FunderDetail } from '#shared/schemas/index.ts'
import { emailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

// Changes at or above this confidence apply straight away; below it they wait on the Activity page.
const AUTO_APPLY_CONFIDENCE = 0.8

/** All that's kept about an email the AI marks personal: nothing about its content. */
export const PERSONAL_EMAIL_SUMMARY = 'Personal email; ignored.'
const SUMMARY_MAX_CHARACTERS = 300

export type EmailSource = 'gmail' | 'forward'

export type ProcessEmailResult =
    | { status: 'already_processed' }
    | { status: 'processed'; evidenceId: string; applied: number; pending: number }
    | { status: 'draft_funder_created'; evidenceId: string; funderId: string }
    | { status: 'not_a_funder'; evidenceId: string }

/**
 * Read one email about a funder with the AI, record the evidence, and update the pipeline.
 *
 * Changes the AI is confident about apply immediately; the rest (and anything that marks an ask lost
 * or lowers an amount) wait for review. A field someone edited by hand after the email was sent is
 * never changed by the AI.
 *
 * @param input.email - The email (body held in memory only).
 * @param input.funderId - The funder it matched.
 * @param input.source - `gmail` or `forward`.
 * @param input.mailboxUserId - Whose mailbox it came from (or who forwarded it).
 * @param input.ai - The AI provider.
 * @returns What happened.
 */
export async function processFunderEmail({
    email,
    funderId,
    source,
    mailboxUserId,
    ai,
}: {
    email: IncomingEmail
    funderId: string
    source: EmailSource
    mailboxUserId: string | null
    ai: AiProvider
}): Promise<ProcessEmailResult> {
    if ((await findProcessedMessageIds({ messageIdHeaders: [email.messageIdHeader] })).size > 0) {
        return { status: 'already_processed' }
    }
    const funder = await loadFunderDetail({ funderId })
    const result = await ai.completeStructured({
        instructions: CLASSIFY_EMAIL_INSTRUCTIONS,
        prompt: buildClassificationPrompt({ email, funder }),
        schema: EmailClassificationSchema,
    })
    const classification = result.status === 'ok' ? sanitizeClassification({ classification: result.output }) : null
    // A personal email (private matters, flirting, complaints or opinions about someone) is ignored
    // completely: only its Message-ID is kept, so it isn't read again. No subject, no summary, no
    // recipients, no changes, and it's never listed anywhere.
    if (classification?.is_sensitive) {
        const ignored = await createEmailEvidence({
            source,
            messageIdHeader: email.messageIdHeader,
            mailboxUserId,
            fromAddress: email.from,
            toAddresses: [],
            sentAt: email.sentAt,
            subject: null,
            summary: PERSONAL_EMAIL_SUMMARY,
            isRelevant: false,
            isSensitive: true,
            funderId,
            model: result.model,
            confidence: null,
        })
        return { status: 'processed', evidenceId: ignored.id, applied: 0, pending: 0 }
    }
    const evidence = await createEmailEvidence({
        source,
        messageIdHeader: email.messageIdHeader,
        mailboxUserId,
        fromAddress: email.from,
        toAddresses: [...email.to, ...email.cc],
        sentAt: email.sentAt,
        subject: classification?.is_sensitive ? null : email.subject.slice(0, 300),
        summary: classification?.summary ?? `The AI couldn't read this email (${result.status}).`,
        isRelevant: classification?.is_relevant ?? false,
        isSensitive: classification?.is_sensitive ?? false,
        funderId,
        model: result.model,
        confidence: classification?.confidence ?? null,
    })
    if (!classification?.is_relevant) {
        return { status: 'processed', evidenceId: evidence.id, applied: 0, pending: 0 }
    }
    const counts = await applyClassification({
        classification,
        funder,
        email,
        evidenceId: evidence.id,
        changeSource: source === 'gmail' ? 'ai_email' : 'ai_forward',
    })
    return { status: 'processed', evidenceId: evidence.id, ...counts }
}

/**
 * A forwarded email from someone the team doesn't track: ask the AI whether they're a potential
 * funder and, if so, create a draft funder for the team to confirm on the Activity page.
 *
 * @param input.email - The forwarded original.
 * @param input.forwardedByUserId - Who forwarded it.
 * @param input.ai - The AI provider.
 * @returns What happened.
 */
export async function proposeDraftFunder({
    email,
    forwardedByUserId,
    ai,
}: {
    email: IncomingEmail
    forwardedByUserId: string
    ai: AiProvider
}): Promise<ProcessEmailResult> {
    if ((await findProcessedMessageIds({ messageIdHeaders: [email.messageIdHeader] })).size > 0) {
        return { status: 'already_processed' }
    }
    const result = await ai.completeStructured({
        instructions: DRAFT_FUNDER_INSTRUCTIONS,
        prompt: [
            `Forwarded email, sent ${todayDateOnly({ now: email.sentAt, timeZone: config.defaultTimeZone })}`,
            `From: ${email.from}`,
            `To: ${email.to.join(', ')}`,
            `Subject: ${email.subject}`,
            '',
            email.text,
        ].join('\n'),
        schema: DraftFunderProposal,
    })
    const proposal = result.status === 'ok' ? result.output : null
    const evidence = await createEmailEvidence({
        source: 'forward',
        messageIdHeader: email.messageIdHeader,
        mailboxUserId: forwardedByUserId,
        fromAddress: email.from,
        toAddresses: [...email.to, ...email.cc],
        sentAt: email.sentAt,
        subject: email.subject.slice(0, 300),
        summary: (proposal?.summary ?? `The AI couldn't read this email (${result.status}).`).slice(
            0,
            SUMMARY_MAX_CHARACTERS,
        ),
        isRelevant: proposal?.is_funder ?? false,
        isSensitive: false,
        funderId: null,
        model: result.model,
        confidence: null,
    })
    if (!proposal?.is_funder || !proposal.organization_name.trim()) {
        return { status: 'not_a_funder', evidenceId: evidence.id }
    }

    // The organization may already be tracked under a name, just not with this sender's address.
    const existing = await findFunderByNameKey({ nameKey: funderNameKey({ name: proposal.organization_name }) })
    const funderId =
        existing?.id ??
        (await createFunderWithDetails({
            name: proposal.organization_name.trim(),
            kind: proposal.kind,
            relationshipStatus: 'early',
            status: 'draft',
            notes: `Drafted from an email forwarded on ${toDateOnly({ date: new Date() })}: ${proposal.summary}`,
            contacts: [{ name: proposal.contact_name || email.from, title: proposal.contact_title, email: email.from }],
            opportunity: {
                goalType: proposal.goal_type,
                stage: 'identified',
                amountCents:
                    proposal.amount_usd && proposal.amount_usd > 0 ? Math.round(proposal.amount_usd * 100) : null,
            },
        }))
    if (existing) {
        await addContactToFunder({
            funderId: existing.id,
            name: proposal.contact_name || email.from,
            email: email.from,
            source: 'ai_forward',
        }).catch(error => console.info('[mail] contact not added', error instanceof Error ? error.message : error))
    }
    await linkEmailEvidenceToFunder({ emailEvidenceId: evidence.id, funderId })
    return { status: 'draft_funder_created', evidenceId: evidence.id, funderId }
}

/**
 * The user message: what the team records about the funder, then the email.
 *
 * @param input.email - The email.
 * @param input.funder - The funder with contacts and opportunities.
 * @returns The prompt text.
 */
export function buildClassificationPrompt({ email, funder }: { email: IncomingEmail; funder: FunderDetail }) {
    const context = {
        funder: {
            name: funder.name,
            relationship_status: funder.relationship_status,
            last_contact_on: funder.last_contact_at,
        },
        contacts: funder.contacts.map(contact => ({ name: contact.name, email: contact.email, title: contact.title })),
        opportunities: funder.opportunities.map(opportunity => ({
            id: opportunity.id,
            name: opportunity.name,
            goal: opportunity.goal_type,
            stage: opportunity.stage,
            amount_usd: opportunity.amount_cents === null ? null : opportunity.amount_cents / 100,
            expected_decision_on: opportunity.expected_decision_at,
            expected_receipt_on: opportunity.expected_receipt_at,
            next_step: opportunity.next_step,
        })),
    }
    return [
        'What Earth Bank currently records:',
        JSON.stringify(context, null, 2),
        '',
        `Email sent ${todayDateOnly({ now: email.sentAt, timeZone: config.defaultTimeZone })}`,
        `From: ${email.from}`,
        `To: ${email.to.join(', ')}`,
        email.cc.length ? `Cc: ${email.cc.join(', ')}` : null,
        `Subject: ${email.subject}`,
        '',
        email.text || '(no text)',
    ]
        .filter(line => line !== null)
        .join('\n')
}

/**
 * Clamp and clean the AI's answer: confidences to 0–1, dates to YYYY-MM-DD, summary to length.
 *
 * @param input.classification - Parsed AI output.
 * @returns A safe copy.
 */
export function sanitizeClassification({
    classification,
}: {
    classification: EmailClassification
}): EmailClassification {
    const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
    const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null)
    return {
        ...classification,
        summary: classification.summary.trim().slice(0, SUMMARY_MAX_CHARACTERS),
        reason: classification.reason.trim().slice(0, 1000),
        confidence: clamp(classification.confidence),
        last_contact_on: date(classification.last_contact_on),
        opportunity_updates: classification.opportunity_updates.map(update => ({
            ...update,
            confidence: clamp(update.confidence),
            expected_decision_on: date(update.expected_decision_on),
            expected_receipt_on: date(update.expected_receipt_on),
            amount_usd: update.amount_usd !== null && update.amount_usd > 0 ? Math.round(update.amount_usd) : null,
            next_step: update.next_step?.trim().slice(0, 500) || null,
            reason: update.reason.trim().slice(0, 1000),
        })),
    }
}

/**
 * Turn the AI's suggestions into change events (applied or pending) and new contacts.
 *
 * @param input.classification - Sanitized AI output.
 * @param input.funder - The funder as it stands.
 * @param input.email - The email (for its sent date).
 * @param input.evidenceId - Evidence to link each change to.
 * @param input.changeSource - `ai_email` or `ai_forward`.
 * @returns How many changes were applied and how many wait for review.
 */
async function applyClassification({
    classification,
    funder,
    email,
    evidenceId,
    changeSource,
}: {
    classification: EmailClassification
    funder: FunderDetail
    email: IncomingEmail
    evidenceId: string
    changeSource: 'ai_email' | 'ai_forward'
}) {
    let applied = 0
    let pending = 0

    /**
     * Apply one batch of changes to one record, split into auto-applied and pending by the rules.
     *
     * @param input.entityType - `funder` or `opportunity`.
     * @param input.entityId - The record.
     * @param input.changes - Proposed field values.
     * @param input.confidence - AI confidence for these changes.
     * @param input.reason - AI reasoning.
     * @param input.riskyFields - Fields that always wait for review.
     * @returns Resolves once written.
     */
    async function propose({
        entityType,
        entityId,
        changes,
        confidence,
        reason,
        riskyFields,
    }: {
        entityType: 'funder' | 'opportunity'
        entityId: string
        changes: Record<string, ChangeValue>
        confidence: number
        reason: string
        riskyFields: Set<string>
    }) {
        const safe: Record<string, ChangeValue> = {}
        const review: Record<string, ChangeValue> = {}
        for (const [field, value] of Object.entries(changes)) {
            const manualAt = await latestManualChangeAt({ entityType, entityId, field })
            if (manualAt && manualAt > email.sentAt) {
                continue
            }
            if (confidence >= AUTO_APPLY_CONFIDENCE && !riskyFields.has(field)) {
                safe[field] = value
            } else {
                review[field] = value
            }
        }
        // Stage rules (approval → funding 60 days later) date from when the email was sent.
        const effectiveOn = todayDateOnly({ now: email.sentAt, timeZone: config.defaultTimeZone })
        const common = {
            entityType,
            entityId,
            source: changeSource,
            evidenceId,
            reason,
            confidence,
            effectiveOn,
        } as const
        applied += (await applyFieldChanges({ ...common, changes: safe as never, status: 'applied' })).length
        pending += (await applyFieldChanges({ ...common, changes: review as never, status: 'pending' })).length
    }

    // Facts read off the email itself (did we really exchange email with this person, and who wrote)
    // aren't held back by the AI's confidence: last contact, and the basic relationship levels.
    const factualChanges: Record<string, ChangeValue> = {}
    if (classification.is_personal_exchange) {
        const sentOn = classification.last_contact_on ?? toDateOnly({ date: email.sentAt })
        if (sentOn && (!funder.last_contact_at || sentOn > funder.last_contact_at)) {
            factualChanges.last_contact_at = sentOn
        }
        const relationshipFloor = basicRelationshipLevel({ fromAddress: email.from })
        // A funder marked dead stays dead until someone decides otherwise.
        if (
            funder.relationship_status !== 'dead' &&
            relationshipRank({ status: relationshipFloor }) > relationshipRank({ status: funder.relationship_status })
        ) {
            factualChanges.relationship_status = relationshipFloor
        }
    }
    await propose({
        entityType: 'funder',
        entityId: funder.id,
        changes: factualChanges,
        confidence: 1,
        reason: factualReason({ changes: factualChanges, fromAddress: email.from }),
        riskyFields: new Set(),
    })

    // Judgement calls beyond the basics (advanced, committed, dead) keep the AI's confidence, and a
    // move to dead always waits for review. The AI never moves a relationship backwards.
    const suggested = classification.relationship_status
    const isJudgementMove =
        suggested !== null &&
        (suggested === 'dead' ||
            relationshipRank({ status: suggested }) >
                Math.max(
                    relationshipRank({ status: funder.relationship_status }),
                    relationshipRank({ status: (factualChanges.relationship_status as string | undefined) ?? null }),
                ))
    if (suggested && isJudgementMove && suggested !== factualChanges.relationship_status) {
        await propose({
            entityType: 'funder',
            entityId: funder.id,
            changes: { relationship_status: suggested },
            confidence: classification.confidence,
            reason: classification.reason,
            riskyFields: new Set(suggested === 'dead' ? ['relationship_status'] : []),
        })
    }

    for (const update of classification.opportunity_updates) {
        const opportunity = funder.opportunities.find(candidate => candidate.id === update.opportunity_id)
        if (!opportunity) {
            continue
        }
        const changes: Record<string, ChangeValue> = {}
        const risky = new Set<string>()
        if (update.stage) {
            changes.stage = update.stage
            if (update.stage === 'lost') {
                risky.add('stage')
            }
        }
        if (update.amount_usd !== null) {
            changes.amount_cents = update.amount_usd * 100
            if (opportunity.amount_cents !== null && update.amount_usd * 100 < opportunity.amount_cents) {
                risky.add('amount_cents')
            }
        }
        if (update.expected_decision_on) {
            changes.expected_decision_at = update.expected_decision_on
        }
        if (update.expected_receipt_on) {
            changes.expected_receipt_at = update.expected_receipt_on
        }
        if (update.next_step) {
            changes.next_step = update.next_step
        }
        await propose({
            entityType: 'opportunity',
            entityId: opportunity.id,
            changes,
            confidence: update.confidence,
            reason: update.reason,
            riskyFields: risky,
        })
    }

    // New contacts must share a domain with the funder (or be the sender), so cc'd colleagues and
    // other organizations never become this funder's contacts.
    const knownEmails = new Set(funder.contacts.map(contact => contact.email))
    const funderDomains = new Set(funder.email_domains)
    for (const contact of classification.new_contacts) {
        const address = normalizeEmailAddress({ email: contact.email })
        const belongsToFunder =
            address !== null && (funderDomains.has(emailDomain({ email: address })) || address === email.from)
        if (!address || !belongsToFunder || knownEmails.has(address) || !contact.name.trim()) {
            continue
        }
        await addContactToFunder({
            funderId: funder.id,
            name: contact.name.trim(),
            title: contact.title,
            email: address,
            notes: 'Added from email',
            source: changeSource,
        }).catch(error => console.info('[mail] contact not added', error instanceof Error ? error.message : error))
    }
    return { applied, pending }
}

// Relationship levels in the order a funder moves through them (dead is outside the order).
const RELATIONSHIP_LEVELS = ['no_contact', 'early', 'active', 'advanced', 'committed']

/**
 * Where a relationship stands in the order, for "only move forward" checks.
 *
 * @param input.status - A relationship status, or null.
 * @returns Its position (-1 for unknown or dead).
 */
function relationshipRank({ status }: { status: string | null }) {
    return status ? RELATIONSHIP_LEVELS.indexOf(status) : -1
}

/**
 * The relationship level a real exchange proves: writing to them is at least early; them writing
 * back personally means we're in dialogue (active).
 *
 * @param input.fromAddress - Who sent the email.
 * @returns `early` or `active`.
 */
function basicRelationshipLevel({ fromAddress }: { fromAddress: string }) {
    return config.internalEmailDomains.includes(emailDomain({ email: fromAddress })) ? 'early' : 'active'
}

/**
 * Plain reason for the factual changes, so the team sees why no confidence was needed.
 *
 * @param input.changes - The factual changes.
 * @param input.fromAddress - Who sent the email.
 * @returns The reason.
 */
function factualReason({ changes, fromAddress }: { changes: Record<string, ChangeValue>; fromAddress: string }) {
    const isFromEarthBank = config.internalEmailDomains.includes(emailDomain({ email: fromAddress }))
    const parts = [
        isFromEarthBank ? 'Earth Bank wrote to someone at this funder' : 'Someone at this funder wrote to Earth Bank',
    ]
    if (changes.relationship_status === 'active') {
        parts.push('a personal reply from the funder means the relationship is active')
    } else if (changes.relationship_status === 'early') {
        parts.push('a real exchange means the relationship has started')
    }
    return `${parts.join('; ')}.`
}
