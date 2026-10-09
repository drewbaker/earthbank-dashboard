import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Save a new scenario.
 *
 * @param input.name - Scenario name.
 * @param input.description - What it explores.
 * @param input.adjustments - Validated adjustments.
 * @param input.createdById - Who made it.
 * @returns The scenario with its creator.
 */
export function createScenarioRow({
    name,
    description,
    adjustments,
    createdById,
}: {
    name: string
    description: string | null
    adjustments: Prisma.InputJsonValue
    createdById: string
}) {
    return db().scenario.create({
        data: { id: newId({ kind: 'scenario' }), name, description, adjustments, created_by_id: createdById },
        include: { created_by: true },
    })
}

/**
 * Every live scenario, newest first.
 *
 * @returns Scenarios with creators.
 */
export function listScenarioRows() {
    return db().scenario.findMany({
        where: { archived_at: null },
        include: { created_by: true },
        orderBy: { id: 'desc' },
    })
}

/**
 * Find a live scenario.
 *
 * @param input.scenarioId - The scenario.
 * @returns The scenario, or null.
 */
export function findScenario({ scenarioId }: { scenarioId: string }) {
    return db().scenario.findFirst({ where: { id: scenarioId, archived_at: null }, include: { created_by: true } })
}

/**
 * Update a scenario.
 *
 * @param input.scenarioId - The scenario.
 * @param input.data - Columns to set.
 * @returns The scenario with its creator.
 */
export function updateScenarioRow({ scenarioId, data }: { scenarioId: string; data: Prisma.ScenarioUpdateInput }) {
    return db().scenario.update({ where: { id: scenarioId }, data, include: { created_by: true } })
}
