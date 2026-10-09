import { defineNitroPlugin } from 'nitropack/runtime'
import { ensureDefaultGoals } from '#server/database/goals.ts'
import { configureDatabase, disconnectDatabase } from '#server/utils/db.ts'

export default defineNitroPlugin(async nitroApp => {
    await configureDatabase()
    // The three funding goals are fixed; make sure they exist before any request needs them.
    await ensureDefaultGoals()
    nitroApp.hooks.hook('close', () => disconnectDatabase())
})
