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
import { addContactToFunder } from '#server/utils/contacts.ts'
import { toDateOnly } from '#server/utils/dates.ts'
import { createFunderWithDetails, loadFunderDetail } from '#server/utils/funders.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import type { FunderDetail } from '#shared/schemas/index.ts'
import { emailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

// Changes at or above this confidence apply straight away; below it they wait on the Activity page.
const AUTO_APPLY_CONFIDENCE = 0.8
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
            `Forwarded email, sent ${email.sentAt.toISOString().slice(0, 10)}`,
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
        `Email sent ${email.sentAt.toISOString().slice(0, 10)}`,
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
        const common = { entityType, entityId, source: changeSource, evidenceId, reason, confidence } as const
        applied += (await applyFieldChanges({ ...common, changes: safe as never, status: 'applied' })).length
        pending += (await applyFieldChanges({ ...common, changes: review as never, status: 'pending' })).length
    }

    const funderChanges: Record<string, ChangeValue> = {}
    if (
        classification.last_contact_on &&
        (!funder.last_contact_at || classification.last_contact_on > funder.last_contact_at)
    ) {
        funderChanges.last_contact_at = classification.last_contact_on
    }
    if (classification.relationship_status) {
        funderChanges.relationship_status = classification.relationship_status
    }
    await propose({
        entityType: 'funder',
        entityId: funder.id,
        changes: funderChanges,
        // Last contact is a fact read off the email itself, so it isn't held back by low confidence.
        confidence: funderChanges.relationship_status ? classification.confidence : 1,
        reason: classification.reason,
        riskyFields: new Set(classification.relationship_status === 'dead' ? ['relationship_status'] : []),
    })

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
