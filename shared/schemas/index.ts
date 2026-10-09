import type { z } from 'zod'
import {
    BankAccount,
    CashSettings,
    CashSummary,
    UpdateBankAccountRequest,
    UpdateCashSettingsRequest,
} from '#shared/schemas/cash.ts'
import { ChangeEvent, ChangeEventList } from '#shared/schemas/change-events.ts'
import { ErrorResponse, UserSummary } from '#shared/schemas/common.ts'
import { Contact, CreateContactRequest, UpdateContactRequest } from '#shared/schemas/contacts.ts'
import { CreateFunderRequest, Funder, FunderDetail, FunderList, UpdateFunderRequest } from '#shared/schemas/funders.ts'
import { ForecastInputs } from '#shared/schemas/forecast.ts'
import { ActivitySummary, EmailEvidence, EmailEvidenceList, MailboxStatus } from '#shared/schemas/mail.ts'
import { Goal, GoalList, UpdateGoalRequest } from '#shared/schemas/goals.ts'
import {
    CreateOpportunityRequest,
    Opportunity,
    OpportunityList,
    UpdateOpportunityRequest,
} from '#shared/schemas/opportunities.ts'
import {
    CreateMilestoneRequest,
    Milestone,
    MilestoneList,
    OpportunityReference,
    UpdateMilestoneRequest,
} from '#shared/schemas/milestones.ts'
import {
    CreateScenarioRequest,
    Scenario,
    ScenarioAdjustment,
    ScenarioList,
    UpdateScenarioRequest,
} from '#shared/schemas/scenarios.ts'
import { StageProbabilities } from '#shared/schemas/settings.ts'
import {
    Attachment,
    Comment,
    CreateCommentRequest,
    CreateTaskRequest,
    ReorderTasksRequest,
    Task,
    TaskDetail,
    TaskList,
    UpdateCommentRequest,
    UpdateTaskRequest,
} from '#shared/schemas/tasks.ts'
import { CurrentUser, User, UserList } from '#shared/schemas/users.ts'

export * from '#shared/schemas/cash.ts'
export * from '#shared/schemas/change-events.ts'
export * from '#shared/schemas/common.ts'
export * from '#shared/schemas/contacts.ts'
export * from '#shared/schemas/forecast.ts'
export * from '#shared/schemas/funders.ts'
export * from '#shared/schemas/goals.ts'
export * from '#shared/schemas/mail.ts'
export * from '#shared/schemas/milestones.ts'
export * from '#shared/schemas/opportunities.ts'
export * from '#shared/schemas/scenarios.ts'
export * from '#shared/schemas/settings.ts'
export * from '#shared/schemas/tasks.ts'
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
    OpportunityReference,
    Milestone,
    MilestoneList,
    CreateMilestoneRequest,
    UpdateMilestoneRequest,
    Task,
    TaskList,
    TaskDetail,
    CreateTaskRequest,
    UpdateTaskRequest,
    ReorderTasksRequest,
    Comment,
    CreateCommentRequest,
    UpdateCommentRequest,
    Attachment,
    BankAccount,
    CashSettings,
    CashSummary,
    UpdateBankAccountRequest,
    UpdateCashSettingsRequest,
    ForecastInputs,
    ScenarioAdjustment,
    Scenario,
    ScenarioList,
    CreateScenarioRequest,
    UpdateScenarioRequest,
    MailboxStatus,
    EmailEvidence,
    EmailEvidenceList,
    ActivitySummary,
}
