/**
 * A web address as people read it: no protocol, no "www.", no trailing slash.
 *
 * @param input.url - The full URL.
 * @param input.dropPrefix - Leading host and path to drop as well, e.g. `linkedin.com/` for LinkedIn pages.
 * @returns "enduringplanet.com", "company/enduring-planet".
 */
export function displayUrl({ url, dropPrefix }: { url: string; dropPrefix?: string }) {
    const readable = url
        .trim()
        .replace(/^https?:\/\/(www\.)?/i, '')
        .replace(/\/+$/, '')
    return dropPrefix && readable.toLowerCase().startsWith(dropPrefix.toLowerCase())
        ? readable.slice(dropPrefix.length).replace(/\/+$/, '')
        : readable
}
