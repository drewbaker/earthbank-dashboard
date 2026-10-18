import { getRouterParam, setResponseHeaders } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadFundDetail } from '#server/utils/funds/fund-detail.ts'
import { buildFundPdf } from '#server/utils/funds/fund-pdf.ts'
import { renderPdf } from '#server/utils/pdf.ts'
import { safeFilename } from '#server/utils/storage.ts'
import { requestToday } from '#server/utils/time-zone.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Download a fund as PDF',
        description:
            'The fund profile for meeting prep: at a glance, team notes, research with numbered sources, the team, and due diligence with open questions.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The PDF',
                content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const fund = await loadFundDetail({ fundManagerId: getRouterParam(event, 'id') ?? '' })
    const preparedOn = requestToday({ event })
    const pdf = await renderPdf({ document: buildFundPdf({ fund, preparedOn }) })
    const filename = `${fund.name} ${preparedOn}.pdf`
    setResponseHeaders(event, {
        'content-type': 'application/pdf',
        'content-length': pdf.length,
        'content-disposition': `attachment; filename="${safeFilename({ filename })}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    })
    return pdf
})
