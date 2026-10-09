// Personal and financial documents (IDs, tax forms, bank details) don't belong in what the AI reads
// for funder emails. They're recognised by file name before anything is downloaded, and by tell-tale
// numbers in the text after it's read; either way the text is never stored.

const SENSITIVE_NAMES: { pattern: RegExp; reason: string }[] = [
    { pattern: /passport/i, reason: 'looks like a passport' },
    {
        pattern: /driv(er'?s?|ing)[\s_-]*licen[cs]e|\blicen[cs]e[\s_-]*(card|scan|copy)\b/i,
        reason: "looks like a driver's license",
    },
    { pattern: /social[\s_-]*security|\bssn\b|\bss[\s_-]*card\b/i, reason: 'looks like a Social Security document' },
    { pattern: /birth[\s_-]*certificate/i, reason: 'looks like a birth certificate' },
    {
        // "Photo ID", "ID card", "ID scan", or a name ending in "ID" ("Drew ID.pdf"), but not "Grant ID list".
        pattern:
            /\b(photo|government|national|state|staff|employee)[\s_-]*id\b|\bid[\s_-]*(card|scan|copy|front|back)\b|[\s_-]id$|identity[\s_-]*(card|document)/i,
        reason: 'looks like an ID document',
    },
    {
        // A bare "visa" would also catch the Visa Foundation, a real funder.
        pattern:
            /\bvisa[\s_-]*(copy|scan|page|stamp|application)\b|green[\s_-]*card|\bi[\s_-]?9\b|work[\s_-]*permit|residence[\s_-]*permit/i,
        reason: 'looks like an immigration document',
    },
    { pattern: /\bw[\s_-]?(2|4|8|9)\b|\b1099\b|\b1040\b|tax[\s_-]*return/i, reason: 'looks like a tax form' },
    {
        pattern: /bank[\s_-]*statement|void(ed)?[\s_-]*check|direct[\s_-]*deposit|routing/i,
        reason: 'looks like bank account details',
    },
    { pattern: /pay[\s_-]*(stub|slip)|payroll|salar(y|ies)/i, reason: 'looks like pay or payroll details' },
    { pattern: /medical|health[\s_-]*record|insurance[\s_-]*card/i, reason: 'looks like a medical document' },
    { pattern: /background[\s_-]*check|credit[\s_-]*report/i, reason: 'looks like a background or credit check' },
]

/**
 * Whether a file name marks a document as sensitive.
 *
 * @param input.name - File name, with or without extension.
 * @returns Why it's sensitive, or null.
 */
export function sensitiveReasonFromName({ name }: { name: string }) {
    const base = name.replace(/\.[a-z0-9]{1,5}$/i, '')
    return SENSITIVE_NAMES.find(({ pattern }) => pattern.test(base))?.reason ?? null
}

/**
 * Whether extracted text holds personal identifiers or account numbers.
 *
 * @param input.text - The document's text.
 * @returns Why it's sensitive, or null.
 */
export function sensitiveReasonFromText({ text }: { text: string }) {
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /social security (number|no\b)/i.test(text)) {
        return 'contains a Social Security number'
    }
    if (/P<[A-Z]{3}[A-Z<]{5,}/.test(text) || /passport\s*(number|no\.?|#)\s*:?\s*[A-Z0-9]{6,9}\b/i.test(text)) {
        return 'contains passport details'
    }
    if (/driver'?s?\s*licen[cs]e\s*(number|no\.?|#)/i.test(text)) {
        return "contains a driver's license number"
    }
    if (
        /routing\s*(number|no\.?|#)?\s*:?\s*\d{9}\b/i.test(text) ||
        /account\s*(number|no\.?|#)\s*:?\s*\d{6,17}\b/i.test(text)
    ) {
        return 'contains bank account numbers'
    }
    if (containsCardNumber({ text })) {
        return 'contains a card number'
    }
    return null
}

/**
 * Whether the text has a 13–19 digit number (spaces or dashes allowed) that passes the Luhn check,
 * i.e. a real payment card number rather than any long number.
 *
 * @param input.text - Text to scan.
 * @returns True when a card number is found.
 */
function containsCardNumber({ text }: { text: string }) {
    for (const match of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
        const digits = match[0].replace(/\D/g, '')
        let sum = 0
        for (let index = 0; index < digits.length; index++) {
            let digit = Number(digits[digits.length - 1 - index])
            if (index % 2 === 1) {
                digit *= 2
                if (digit > 9) {
                    digit -= 9
                }
            }
            sum += digit
        }
        if (sum % 10 === 0 && !/^(\d)\1+$/.test(digits)) {
            return true
        }
    }
    return false
}
