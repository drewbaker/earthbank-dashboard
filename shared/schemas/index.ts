import type { z } from 'zod'
import { ChangeEvent, ChangeEventList } from '#shared/schemas/change-events.ts'
import { ErrorResponse, UserSummary } from '#shared/schemas/common.ts'
import { Contact, CreateContactRequest, UpdateContactRequest } from '#shared/schemas/contacts.ts'
import { CreateFunderRequest, Funder, FunderDetail, FunderList, UpdateFunderRequest } from '#shared/schemas/funders.ts'
import { Goal, GoalList, UpdateGoalRequest } from '#shared/schemas/goals.ts'
import {
    CreateOpportunityRequest,
    Opportunity,
    OpportunityList,
    UpdateOpportunityRequest,
} from '#shared/schemas/opportunities.ts'
import { StageProbabilities } from '#shared/schemas/settings.ts'
import { CurrentUser, User, UserList } from '#shared/schemas/users.ts'

export * from '#shared/schemas/change-events.ts'
export * from '#shared/schemas/common.ts'
export * from '#shared/schemas/contacts.ts'
export * from '#shared/schemas/funders.ts'
export * from '#shared/schemas/goals.ts'
export * from '#shared/schemas/opportunities.ts'
export * from '#shared/schemas/settings.ts'
export * from '#shared/schemas/users.ts'

// Every schema referenced as #/components/schemas/<Name> in route meta. The OpenAPI plugin turns
// these into JSON Schema, so route files can stay static literals.
export const openapiSchemas: Record<string, z.ZodType> = {
    ErrorResponse,
    UserSummary,
    User,
    UserList,
    CurrentUser,
    Contact,
    CreateContactRequest,
    UpdateContactRequest,
    Funder,
    FunderDetail,
    FunderList,
    CreateFunderRequest,
    UpdateFunderRequest,
    Opportunity,
    OpportunityList,
    CreateOpportunityRequest,
    UpdateOpportunityRequest,
    Goal,
    GoalList,
    UpdateGoalRequest,
    ChangeEvent,
    ChangeEventList,
    StageProbabilities,
}
