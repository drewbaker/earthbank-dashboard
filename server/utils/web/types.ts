/** A page read with a full browser. */
export type ReadPage = {
    url: string
    title: string | null
    markdown: string
    links: string[]
    statusCode: number | null
}

/** One web search result: its address and the search engine's snippet. */
export type WebSearchHit = { url: string; title: string | null; snippet: string | null }

/** Why a page couldn't be read (`enrichment_not_enabled` is LinkedIn before Firecrawl enrichment is turned on). */
export type ReadFailure = {
    code: 'enrichment_not_enabled' | 'no_match' | 'blocked' | 'not_found' | 'rate_limited' | 'out_of_credits' | 'failed'
    message: string
}

/** One job or school from a person's profile. Dates are YYYY or YYYY-MM as the provider gives them. */
export type ProfileEntry = {
    organization: string
    website: string | null
    title: string | null
    startDate: string | null
    endDate: string | null
}

/** A person's professional profile from a data provider, looked up by their LinkedIn URL. */
export type PersonProfile = {
    provider: string
    matchConfidence: string | null
    employment: ProfileEntry[]
    education: ProfileEntry[]
}

/**
 * Reads pages that block plain requests or need JavaScript, searches the web, and looks up people's
 * professional profiles, from the server.
 * Every call reports the vendor credits it used so research budgets include them.
 */
export interface WebReader {
    name: string
    readPage(input: {
        url: string
        waitForMs?: number
    }): Promise<{ page: ReadPage | null; failure: ReadFailure | null; credits: number }>
    search(input: {
        query: string
        limit: number
    }): Promise<{ hits: WebSearchHit[]; failure: ReadFailure | null; credits: number }>
    /** Look up a person's work history and education from their LinkedIn URL (no contact details). */
    lookupPerson(input: {
        linkedinUrl: string
    }): Promise<{ profile: PersonProfile | null; failure: ReadFailure | null; credits: number }>
}
