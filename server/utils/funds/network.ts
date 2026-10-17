import { readFundNetworkRows } from '#server/database/fund-research.ts'
import type { ResearchOrganizationKind } from '#shared/constants/funds.ts'
import type { FundNetwork } from '#shared/schemas/index.ts'

/**
 * The team network around one fund, for the graph on its profile.
 *
 * Nodes: the fund, its people, the organizations they worked or studied at, and other funds whose
 * people share those organizations. Edges: fund–person (team), person–organization (employment,
 * education, board), and organization–other fund (through that fund's person).
 *
 * @param input.fundManagerId - The fund at the center.
 * @param input.fundName - Its name.
 * @returns Nodes and edges.
 */
export async function buildFundNetwork({
    fundManagerId,
    fundName,
}: {
    fundManagerId: string
    fundName: string
}): Promise<FundNetwork> {
    const { people, sharedAffiliations } = await readFundNetworkRows({ fundManagerId })
    const nodes = new Map<string, FundNetwork['nodes'][number]>()
    const edges = new Map<string, FundNetwork['edges'][number]>()
    const addEdge = (edge: FundNetwork['edges'][number]) =>
        edges.set(`${edge.source}>${edge.target}>${edge.relation}`, edge)

    nodes.set(fundManagerId, {
        id: fundManagerId,
        kind: 'fund',
        label: fundName,
        fund_id: fundManagerId,
        organization_kind: null,
        is_focus: true,
    })
    for (const person of people) {
        nodes.set(person.id, {
            id: person.id,
            kind: 'person',
            label: person.name,
            fund_id: null,
            organization_kind: null,
            is_focus: false,
        })
        addEdge({ source: fundManagerId, target: person.id, relation: 'team' })
        for (const affiliation of person.affiliations) {
            const organization = affiliation.organization
            // An organization that is itself this fund (a person's current job) is the fund node.
            if (organization.fund_manager_id === fundManagerId) {
                continue
            }
            nodes.set(organization.id, {
                id: organization.id,
                kind: 'organization',
                label: organization.name,
                fund_id: organization.fund_manager_id,
                organization_kind: organization.kind as ResearchOrganizationKind,
                is_focus: false,
            })
            addEdge({
                source: person.id,
                target: organization.id,
                relation: affiliation.relation as 'employment' | 'education' | 'board',
            })
        }
    }
    for (const affiliation of sharedAffiliations) {
        const otherFund = affiliation.person.fund_manager
        nodes.set(otherFund.id, {
            id: otherFund.id,
            kind: 'fund',
            label: otherFund.name,
            fund_id: otherFund.id,
            organization_kind: null,
            is_focus: false,
        })
        addEdge({
            source: affiliation.organization_id,
            target: otherFund.id,
            relation: affiliation.relation as 'employment' | 'education' | 'board',
        })
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] }
}
