import { defineEventHandler } from 'h3'
import { proxyJobsDashboard } from '#server/utils/jobs/dashboard-proxy.ts'

export default defineEventHandler(event => proxyJobsDashboard({ event }))
