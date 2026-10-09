// Score the email classifier against labelled examples.
//
//   npm run eval:classify-email [-- path/to/fixtures]
//
// Each fixture is a JSON file with a funder, an email and the expected result (see
// tests/fixtures/emails/sample-approval.json). Real emails belong in tests/fixtures/private/emails
// (git-ignored). Every run calls the Anthropic API and costs money: one request per fixture.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CLASSIFY_EMAIL_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { EmailClassification } from '#server/utils/ai/schemas.ts'
import { buildClassificationPrompt, sanitizeClassification } from '#server/utils/mail/classify.ts'
import type { FunderDetail } from '#shared/schemas/index.ts'

type Fixture = {
    description: string
    funder: Pick<FunderDetail, 'name' | 'relationship_status' | 'last_contact_at'> & {
        contacts: FunderDetail['contacts']
        opportunities: FunderDetail['opportunities']
    }
    email: { from: string; to: string[]; sentAt: string; subject: string; text: string }
    expected: {
        is_relevant: boolean
        is_sensitive?: boolean
        relationship_status?: string | null
        opportunities?: Record<
            string,
            Partial<Record<'stage' | 'expected_receipt_on' | 'expected_decision_on' | 'amount_usd', unknown>>
        >
    }
}

const directory = resolve(process.argv[2] ?? 'tests/fixtures/emails')
const ai = aiProvider()
if (!ai) {
    console.error('Set ANTHROPIC_API_KEY to run the eval.')
    process.exit(1)
}

const files = readdirSync(directory).filter(file => file.endsWith('.json'))
let checks = 0
let passes = 0
for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Fixture
    const prompt = buildClassificationPrompt({
        funder: fixture.funder as unknown as FunderDetail,
        email: { ...fixture.email, messageIdHeader: file, cc: [], sentAt: new Date(fixture.email.sentAt) },
    })
    const result = await ai.completeStructured({
        instructions: CLASSIFY_EMAIL_INSTRUCTIONS,
        prompt,
        schema: EmailClassification,
    })
    if (result.status !== 'ok') {
        console.info(`✗ ${file}: ${result.status}`)
        checks++
        continue
    }
    const output = sanitizeClassification({ classification: result.output })
    const comparisons: [string, unknown, unknown][] = [
        ['is_relevant', fixture.expected.is_relevant, output.is_relevant],
    ]
    if (fixture.expected.is_sensitive !== undefined) {
        comparisons.push(['is_sensitive', fixture.expected.is_sensitive, output.is_sensitive])
    }
    if (fixture.expected.relationship_status !== undefined) {
        comparisons.push(['relationship_status', fixture.expected.relationship_status, output.relationship_status])
    }
    for (const [opportunityId, fields] of Object.entries(fixture.expected.opportunities ?? {})) {
        const update = output.opportunity_updates.find(candidate => candidate.opportunity_id === opportunityId)
        for (const [field, expected] of Object.entries(fields)) {
            comparisons.push([`${opportunityId}.${field}`, expected, update?.[field as keyof typeof update] ?? null])
        }
    }
    for (const [label, expected, actual] of comparisons) {
        checks++
        const isMatch = JSON.stringify(expected) === JSON.stringify(actual)
        passes += isMatch ? 1 : 0
        console.info(
            `${isMatch ? '✓' : '✗'} ${file} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        )
    }
}
console.info(`\n${passes}/${checks} checks passed across ${files.length} emails (model ${ai.model})`)
