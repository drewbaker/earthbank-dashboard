// Re-deliver emails a Gmail routing mistake sent to Resend instead of the team. Lists every email
// received since --since, works out which Earth Bank people it was really addressed to (its To and
// Cc headers), and with --send forwards each one to them under a short note.
//
//   npx tsx scripts/forward-misrouted-emails.ts --since 2026-10-09T18:00:00Z
//   npx tsx scripts/forward-misrouted-emails.ts --since 2026-10-09T18:00:00Z --send --note-file note.txt --only id1,id2
//
// Without --send it only prints the plan.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Resend } from 'resend'
import { config } from '#server/utils/config.ts'
import { emailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

const { values } = parseArgs({
    options: {
        since: { type: 'string' },
        send: { type: 'boolean', default: false },
        'note-file': { type: 'string' },
        // Comma-separated email ids: send only these (after checking the dry run).
        only: { type: 'string' },
        from: { type: 'string', default: 'Drew Baker via Earth Bank Dashboard <noreply@mail.theearthbank.org>' },
    },
})

if (!values.since || Number.isNaN(Date.parse(values.since))) {
    console.error('Pass --since with an ISO time, e.g. --since 2026-10-09T18:00:00Z')
    process.exit(1)
}
if (values.send && !values['note-file']) {
    console.error('Pass --note-file with the note to put above each forwarded email.')
    process.exit(1)
}

const resend = new Resend(config.resendApiKey)
const since = Date.parse(values.since)
const dashboardLocalPart = config.dashboardEmailAddress.split('@')[0]

const plan = await planForwards()
for (const item of plan) {
    console.info(
        `${item.receivedAt}  ${item.id}\n  from: ${item.from}\n  subject: ${item.subject}\n  ` +
            (item.recipients.length ? `forward to: ${item.recipients.join(', ')}` : 'skip: no Earth Bank recipient'),
    )
}

if (values.send) {
    const note = readFileSync(values['note-file']!, 'utf8').trim()
    const onlyIds = values.only ? new Set(values.only.split(',').map(id => id.trim())) : null
    for (const item of plan.filter(entry => entry.recipients.length > 0 && (!onlyIds || onlyIds.has(entry.id)))) {
        const { error } = await resend.emails.receiving.forward({
            emailId: item.id,
            to: item.recipients,
            from: values.from!,
            passthrough: false,
            text: note,
            html: note
                .split(/\n{2,}/)
                .map(paragraph => `<p>${escapeHtml({ text: paragraph }).replace(/\n/g, '<br>')}</p>`)
                .join(''),
        })
        console.info(error ? `FAILED ${item.id}: ${error.message}` : `forwarded ${item.id}`)
    }
}

/**
 * Every email received since the cutoff, with its intended Earth Bank recipients.
 *
 * @returns One entry per email, oldest first.
 */
async function planForwards() {
    const entries: { id: string; receivedAt: string; from: string; subject: string; recipients: string[] }[] = []
    let after: string | undefined
    for (;;) {
        const { data, error } = await resend.emails.receiving.list({ limit: 100, ...(after ? { after } : {}) })
        if (error || !data) {
            throw new Error(`Resend list failed: ${error?.message ?? 'no data'}`)
        }
        for (const summary of data.data) {
            if (Date.parse(summary.created_at) < since) {
                continue
            }
            const { data: email } = await resend.emails.receiving.get(summary.id)
            if (!email) {
                continue
            }
            entries.push({
                id: email.id,
                receivedAt: email.created_at,
                from: email.from,
                subject: email.subject ?? '',
                recipients: intendedRecipients({ headers: email.headers ?? {}, to: email.to }),
            })
        }
        if (!data.has_more || data.data.length === 0) {
            break
        }
        after = data.data.at(-1)!.id
    }
    return entries.sort((first, second) => first.receivedAt.localeCompare(second.receivedAt))
}

/**
 * The Earth Bank people an email was addressed to (To and Cc headers), not the dashboard itself.
 * Every one of them lost their copy: the routing rule redirected all of the Workspace's mail.
 *
 * @param input.headers - The email's headers.
 * @param input.to - Resend's To list, as a fallback.
 * @returns Lowercased addresses.
 */
function intendedRecipients({ headers, to }: { headers: Record<string, string>; to: string[] }) {
    const headerValue = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? ''
    const listed = [headerValue('to'), headerValue('cc')].join(',') || to.join(',')
    const addresses = (listed.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? [])
        .map(address => normalizeEmailAddress({ email: address }))
        .filter((address): address is string => Boolean(address))
    return [...new Set(addresses)].filter(
        address =>
            config.internalEmailDomains.includes(emailDomain({ email: address })) &&
            address.split('@')[0] !== dashboardLocalPart &&
            emailDomain({ email: address }) !== config.inboundEmailDomain,
    )
}

/**
 * Escape text for HTML.
 *
 * @param input.text - Plain text.
 * @returns HTML-safe text.
 */
function escapeHtml({ text }: { text: string }) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
