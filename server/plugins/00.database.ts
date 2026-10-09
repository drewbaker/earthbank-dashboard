import { defineNitroPlugin } from 'nitropack/runtime'
import { configureDatabase, disconnectDatabase } from '#server/utils/db.ts'

export default defineNitroPlugin(async nitroApp => {
    await configureDatabase()
    nitroApp.hooks.hook('close', () => disconnectDatabase())
})
