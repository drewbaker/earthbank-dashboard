import { defineNitroPlugin } from 'nitropack/runtime'
import { ensureDefaultGoals } from '#server/database/goals.ts'
import { supersedeAllStaleSuggestions } from '#server/utils/change-events.ts'
import { configureDatabase, disconnectDatabase } from '#server/utils/db.ts'

export default defineNitroPlugin(async nitroApp => {
    await configureDatabase()
    // The three funding goals are fixed; make sure they exist before any request needs them.
    await ensureDefaultGoals()
    // Clears out-of-date suggestions right after a deploy instead of waiting for the hourly cleanup.
    supersedeAllStaleSuggestions()
        .then(count => count > 0 && console.info(`[changes] retired ${count} out-of-date suggestions`))
        .catch(error => console.error('[changes] retiring out-of-date suggestions failed', error))
    nitroApp.hooks.hook('close', () => disconnectDatabase())
})
