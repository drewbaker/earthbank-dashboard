import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024
const MAX_REDIRECTS = 5

/** A fetched response body with its final URL and content type. */
export type SafeFetchResult = { url: string; status: number; contentType: string; body: Buffer }

/**
 * Fetch a public URL without reaching private networks.
 *
 * Every hop (redirects are followed by hand) must be http(s) on a host that resolves only to public
 * addresses; the body is cut off at a size cap. Use this for any URL the app didn't hard-code.
 *
 * @param input.url - The URL.
 * @param input.init - Extra fetch options (method, headers, body).
 * @param input.maxBytes - Largest body to read (default 15 MB).
 * @param input.timeoutMs - Whole-request timeout (default 60 s).
 * @returns The response body and its final URL.
 * @throws Error when the URL isn't public, there are too many redirects, or the body is too large.
 */
export async function safeFetch({
    url,
    init = {},
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = 60_000,
}: {
    url: string
    init?: RequestInit
    maxBytes?: number
    timeoutMs?: number
}): Promise<SafeFetchResult> {
    let current = new URL(url)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        await assertPublicUrl({ url: current })
        const response = await fetch(current, {
            ...init,
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
            headers: { 'user-agent': 'EarthBankDashboard/1.0 (+https://dashboard.theearthbank.org)', ...init.headers },
        })
        const location = response.headers.get('location')
        if (response.status >= 300 && response.status < 400 && location) {
            current = new URL(location, current)
            continue
        }
        return {
            url: current.toString(),
            status: response.status,
            contentType: response.headers.get('content-type') ?? '',
            body: await readCapped({ response, maxBytes }),
        }
    }
    throw new Error(`Too many redirects fetching ${url}`)
}

/**
 * Whether an IP address is private, loopback, link-local or otherwise not on the public internet.
 *
 * @param input.address - IPv4 or IPv6 address.
 * @returns True when it must not be fetched.
 */
export function isPrivateAddress({ address }: { address: string }) {
    if (isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number) as [number, number]
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224
        )
    }
    const lower = address.toLowerCase()
    if (lower.startsWith('::ffff:')) {
        return isPrivateAddress({ address: lower.slice(7) })
    }
    return (
        lower === '::' ||
        lower === '::1' ||
        lower.startsWith('fc') ||
        lower.startsWith('fd') ||
        lower.startsWith('fe80')
    )
}

/**
 * Reject URLs that aren't http(s) on a public host.
 *
 * @param input.url - The URL.
 * @returns Resolves when allowed.
 * @throws Error when not allowed.
 */
async function assertPublicUrl({ url }: { url: URL }) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`Only http(s) URLs can be fetched: ${url}`)
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress({ address }))) {
        throw new Error(`Refusing to fetch a private address: ${url.hostname}`)
    }
}

/**
 * Read a response body, stopping at a size cap.
 *
 * @param input.response - The response.
 * @param input.maxBytes - Largest body allowed.
 * @returns The body.
 * @throws Error when it is larger.
 */
async function readCapped({ response, maxBytes }: { response: Response; maxBytes: number }) {
    const chunks: Buffer[] = []
    let size = 0
    if (!response.body) {
        return Buffer.alloc(0)
    }
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength
        if (size > maxBytes) {
            throw new Error(`Response larger than ${maxBytes} bytes`)
        }
        chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}
