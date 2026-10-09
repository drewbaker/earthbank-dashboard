import { defineNitroPlugin } from 'nitropack/runtime'
import { z } from 'zod'
import { openapiSchemas } from '#shared/schemas/index.ts'

// Route meta must be static literals, so routes reference #/components/schemas/<Name>. This fills
// those components from the shared zod schemas when the document is served.
export default defineNitroPlugin(nitroApp => {
    const components = Object.fromEntries(
        Object.entries(openapiSchemas).map(([name, schema]) => [
            name,
            // Requests are documented as the client sends them (before transforms), responses as returned.
            z.toJSONSchema(schema, {
                target: 'openapi-3.0',
                io: name.endsWith('Request') ? 'input' : 'output',
                unrepresentable: 'any',
            }),
        ]),
    )
    nitroApp.hooks.hook('beforeResponse', (event, response) => {
        if (!event.path.startsWith('/_openapi.json') || !isOpenApiDocument(response.body)) {
            return
        }
        // Only the /v1 API belongs in the reference; Nuxt internals, auth redirects and the catch-all don't.
        response.body.paths = Object.fromEntries(
            Object.entries(response.body.paths ?? {}).filter(
                ([path]) => path.startsWith('/v1/') && path !== '/v1/{path}',
            ),
        )
        response.body.components = {
            ...response.body.components,
            schemas: { ...response.body.components?.schemas, ...components },
            securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'earthbank_dashboard_session' } },
        }
        response.body.security = [{ session: [] }]
    })
})

type OpenApiDocument = {
    paths?: Record<string, unknown>
    components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> }
    security?: unknown[]
}

/**
 * Narrow a response body to an OpenAPI document.
 *
 * @param body - The response body Nitro is about to send.
 * @returns True when it looks like an OpenAPI document.
 */
function isOpenApiDocument(body: unknown): body is OpenApiDocument {
    return typeof body === 'object' && body !== null && 'openapi' in body
}
