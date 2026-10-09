// Fixed vocabularies for the fundraising pipeline, shared by the API, the UI and the importer.
// Colors are Nuxt UI semantic colors so badges follow the theme and dark mode.

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export const GOAL_TYPES = ['design_grant', 'opex', 'lending_capital'] as const
export type GoalType = (typeof GOAL_TYPES)[number]

export const GOAL_TYPE_DETAILS: Record<GoalType, { label: string; description: string; color: BadgeColor }> = {
    design_grant: {
        label: 'Design Grants',
        description: 'Short-term grants to design the Earth Bank structure.',
        color: 'primary',
    },
    opex: {
        label: 'OpEx',
        description: 'Short-term capital to fund operating expenses.',
        color: 'info',
    },
    lending_capital: {
        label: 'Lending Capital',
        description: 'Longer-term capital Earth Bank will lend.',
        color: 'warning',
    },
}

export const OPPORTUNITY_STAGES = [
    'identified',
    'in_discussion',
    'proposal',
    'due_diligence',
    'in_committee',
    'committed',
    'received',
    'lost',
] as const
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]

export const OPPORTUNITY_STAGE_DETAILS: Record<
    OpportunityStage,
    { label: string; color: BadgeColor; isOpen: boolean; defaultProbability: number }
> = {
    identified: { label: 'Identified', color: 'neutral', isOpen: true, defaultProbability: 5 },
    in_discussion: { label: 'In discussion', color: 'info', isOpen: true, defaultProbability: 15 },
    proposal: { label: 'Proposal', color: 'secondary', isOpen: true, defaultProbability: 35 },
    due_diligence: { label: 'Due diligence', color: 'warning', isOpen: true, defaultProbability: 60 },
    in_committee: { label: 'In committee', color: 'info', isOpen: true, defaultProbability: 80 },
    // Stored as `committed` (the spreadsheet's word); the team calls it approved.
    committed: { label: 'Approved', color: 'success', isOpen: false, defaultProbability: 95 },
    received: { label: 'Received', color: 'primary', isOpen: false, defaultProbability: 100 },
    lost: { label: 'Declined', color: 'error', isOpen: false, defaultProbability: 0 },
}

/** Once an ask has gone to the funder's committee, it's at least this likely (0–100). */
export const COMMITTEE_MIN_PROBABILITY = 80

/** Approved money is expected to arrive this many days after approval, unless a date is known. */
export const APPROVAL_TO_FUNDING_DAYS = 60

export const FUNDER_TIERS = ['t1', 't2', 't3', 't4'] as const
export type FunderTier = (typeof FUNDER_TIERS)[number]

export const FUNDER_TIER_DETAILS: Record<FunderTier, { label: string; description: string; color: BadgeColor }> = {
    t1: { label: 'T1', description: 'Hot: advanced stage and/or large catalytic $', color: 'error' },
    t2: { label: 'T2', description: 'Active: in dialogue, promising', color: 'warning' },
    t3: { label: 'T3', description: 'Early: cultivating a nascent relationship', color: 'info' },
    t4: { label: 'T4', description: 'Target: no relationship yet', color: 'neutral' },
}

export const RELATIONSHIP_STATUSES = ['no_contact', 'early', 'active', 'advanced', 'committed', 'dead'] as const
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number]

export const RELATIONSHIP_STATUS_DETAILS: Record<RelationshipStatus, { label: string; color: BadgeColor }> = {
    no_contact: { label: 'No contact', color: 'neutral' },
    early: { label: 'Early', color: 'info' },
    active: { label: 'Active', color: 'secondary' },
    advanced: { label: 'Advanced', color: 'warning' },
    committed: { label: 'Committed', color: 'success' },
    dead: { label: 'Dead', color: 'error' },
}

export const FUNDER_KINDS = ['foundation', 'dfi', 'corporate', 'individual', 'government', 'other'] as const
export type FunderKind = (typeof FUNDER_KINDS)[number]

export const FUNDER_KIND_LABELS: Record<FunderKind, string> = {
    foundation: 'Foundation',
    dfi: 'Development finance institution',
    corporate: 'Corporate',
    individual: 'Individual',
    government: 'Government',
    other: 'Other',
}

export const FUNDER_STATUSES = ['active', 'draft'] as const
export type FunderStatus = (typeof FUNDER_STATUSES)[number]

export const CHANGE_SOURCES = ['manual', 'import', 'ai_email', 'ai_forward', 'ai_instruction'] as const
export type ChangeSource = (typeof CHANGE_SOURCES)[number]

export const CHANGE_SOURCE_LABELS: Record<ChangeSource, string> = {
    manual: 'Manual edit',
    import: 'Spreadsheet import',
    ai_email: 'AI from email',
    ai_forward: 'AI from forwarded email',
    ai_instruction: 'Instruction by email',
}

// superseded: a suggestion made out of date by a newer email or edit to the same field.
export const CHANGE_STATUSES = ['applied', 'pending', 'rejected', 'reverted', 'superseded'] as const
export type ChangeStatus = (typeof CHANGE_STATUSES)[number]

export const MILESTONE_KINDS = ['funding', 'event', 'internal'] as const
export type MilestoneKind = (typeof MILESTONE_KINDS)[number]

export const MILESTONE_KIND_DETAILS: Record<MilestoneKind, { label: string; icon: string }> = {
    funding: { label: 'Funding', icon: 'i-lucide-landmark' },
    event: { label: 'Event', icon: 'i-lucide-calendar-days' },
    internal: { label: 'Internal', icon: 'i-lucide-flag' },
}

export const MILESTONE_STATUSES = ['open', 'done'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_DETAILS: Record<TaskStatus, { label: string; color: BadgeColor; icon: string }> = {
    todo: { label: 'To do', color: 'neutral', icon: 'i-lucide-circle' },
    doing: { label: 'In progress', color: 'info', icon: 'i-lucide-circle-dot' },
    done: { label: 'Done', color: 'success', icon: 'i-lucide-circle-check' },
}
