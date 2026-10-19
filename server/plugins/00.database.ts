import { defineNitroPlugin } from 'nitropack/runtime'
import { ensureDefaultGoals } from '#server/database/goals.ts'
import { supersedeAllStaleSuggestions } from '#server/utils/change-events.ts'
import { reattributeSyncedEmails } from '#server/utils/mail/attribution.ts'
import { fillMissingFitSignals } from '#server/utils/funds/refresh-values.ts'
import { fillFocusAreasFromGeoFocus } from '#server/utils/pipeline-import/focus-areas.ts'
import { configureDatabase, disconnectDatabase } from '#server/utils/db.ts'

export default defineNitroPlugin(async nitroApp => {
    await configureDatabase()
    // The three funding goals are fixed; make sure they exist before any request needs them.
    await ensureDefaultGoals()
    // Clears out-of-date suggestions right after a deploy instead of waiting for the hourly cleanup.
    supersedeAllStaleSuggestions()
        .then(count => count > 0 && console.info(`[changes] retired ${count} out-of-date suggestions`))
        .catch(error => console.error('[changes] retiring out-of-date suggestions failed', error))
    // Funders imported before opportunities had a geographic focus get it from the sheet's Geo Focus.
    fillFocusAreasFromGeoFocus()
        .then(count => count > 0 && console.info(`[import] filled geographic focus on ${count} opportunities`))
        .catch(error => console.error('[import] filling geographic focus failed', error))
    // Emails read before ownership followed the sender were credited to whichever inbox synced first.
    reattributeSyncedEmails()
        .then(count => count > 0 && console.info(`[mail] credited ${count} emails to their sender or recipient`))
        .catch(error => console.error('[mail] crediting emails failed', error))
    // Funds researched before the fit signals existed get them from their stored research.
    fillMissingFitSignals()
        .then(count => count > 0 && console.info(`[research] worked out fit signals for ${count} funds`))
        .catch(error => console.error('[research] working out fit signals failed', error))
    nitroApp.hooks.hook('close', () => disconnectDatabase())
})
