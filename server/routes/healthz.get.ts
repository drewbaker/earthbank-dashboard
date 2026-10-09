import { defineEventHandler, setResponseHeader } from 'h3'
import { db } from '#server/utils/db.ts'

// Render's health check. Touches the database so a broken disk fails the check.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'no-store')
    await db().$queryRawUnsafe('SELECT 1')
    return { ok: true }
})
