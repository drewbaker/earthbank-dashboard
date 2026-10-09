/**
 * Escape text for HTML email bodies.
 *
 * @param input.text - Untrusted text (task titles, comments).
 * @returns HTML-safe text.
 */
export function escapeHtml({ text }: { text: string }) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * A simple branded email: heading, paragraphs, optional quote, one button. Returns both HTML and text.
 *
 * @param input.heading - First line.
 * @param input.paragraphs - Body paragraphs (plain text; escaped here).
 * @param input.quote - Optional quoted text, e.g. a comment.
 * @param input.buttonLabel - Call to action.
 * @param input.buttonUrl - Where it goes.
 * @returns `{ html, text }`.
 */
export function renderEmail({
    heading,
    paragraphs,
    quote,
    buttonLabel,
    buttonUrl,
}: {
    heading: string
    paragraphs: string[]
    quote?: string
    buttonLabel: string
    buttonUrl: string
}) {
    const paragraphHtml = paragraphs
        .map(paragraph => `<p style="margin:0 0 12px;color:#3f3f46;">${escapeHtml({ text: paragraph })}</p>`)
        .join('')
    const quoteHtml = quote
        ? `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #15803d;background:#f4f4f5;color:#27272a;white-space:pre-line;">${escapeHtml({ text: quote })}</blockquote>`
        : ''
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fafafa;font-family:'Public Sans',Arial,sans-serif;font-size:15px;line-height:1.5;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:4px;padding:24px;">
<p style="margin:0 0 16px;font-size:13px;color:#15803d;font-weight:600;">Earth Bank Dashboard</p>
<h1 style="margin:0 0 16px;font-size:18px;color:#18181b;">${escapeHtml({ text: heading })}</h1>
${paragraphHtml}${quoteHtml}
<p style="margin:20px 0 0;"><a href="${escapeHtml({ text: buttonUrl })}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:4px;font-weight:600;">${escapeHtml({ text: buttonLabel })}</a></p>
</div></body></html>`
    const text = [heading, '', ...paragraphs, ...(quote ? ['', quote] : []), '', `${buttonLabel}: ${buttonUrl}`].join(
        '\n',
    )
    return { html, text }
}
