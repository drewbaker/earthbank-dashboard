# Earth Bank Dashboard: Nuxt + Nitro + SQLite on Render

An internal dashboard for Earth Bank leadership, built on the house Nuxt + Nitro + SQLite on Render stack. §0 describes the product. Everything after it is the house default, adjusted where this product differs; each change says why. The phased delivery plan is in [`docs/build-plan.md`](docs/build-plan.md).

Names used throughout: **Earth Bank Dashboard** (display name), `earthbank_dashboard` (cookies, key prefixes), `earthbank-dashboard` (Render service), `theearthbank.org` (domain). The app lives at `https://dashboard.theearthbank.org`.

---

## 0. The product

- **Problem**: Earth Bank's leaders run fundraising from a Google Sheet ("Earth Bank - Fundraising, Fund Manager, and Contacts"). Its Master Pipeline tab tracks about 60 funders with tier, status, $ amounts, last contact and free-text "NEXT:" notes. Nobody has one view of cash runway against when pipeline money will land, or of who owes what by when. Statuses go stale between email threads. The dashboard keeps the whole team focused on the funding goals and agreed on what has to happen next.
- **Users and roles**: Earth Bank leadership, all `admin`. The first users are Drew, Leslie and Steve. **Sign-in is Google-only and limited to `@theearthbank.org` Workspace accounts.** An account is created the first time someone signs in, so giving a person access means giving them an Earth Bank Google account. (`resolvefund.org` is an alias in the same Workspace; Google always returns the primary `@theearthbank.org` address.) Everything requires sign-in. Keep a `role` column so viewer/editor roles can be added later.
- **Funding goals**: every opportunity is tagged with one goal type.
    - `design_grant`: short-term grants to design the Earth Bank structure.
    - `opex`: short-term capital to fund operating expenses.
    - `lending_capital`: the longer-term goal, capital Earth Bank will lend (the spreadsheet's "Potential Follow-On $").
- **Core objects** (Prisma models, `/v1` resources, ID prefixes):

| Object | Prefix | What it is |
|---|---|---|
| User | `usr` | A signed-in team member |
| Session | `ses` | |
| Funder | `fnd` | The organization (foundation, DFI, corporate, individual); `kind` leaves room for bank partners and fund managers later |
| Contact | `con` | A person at a funder, with email |
| Opportunity | `opp` | One ask to one funder for one goal: amount, stage, probability, expected decision and receipt dates, next step, owner |
| Goal | `gol` | Design Grants / OpEx / Lending Capital, with target $ and target date |
| Milestone | `mst` | A dated funding milestone or event, linked to a goal or opportunity |
| Task | `tsk` | A to-do under a milestone or opportunity: assignee, deadline, status |
| Comment | `cmt` | A comment on a task |
| Attachment | `att` | A file attached to a task |
| Bank account | `bac` | Synced from Bookeeping.ai |
| Balance snapshot | `bal` | Daily balance per bank account |
| Bank transaction | `btx` | Synced from Bookeeping.ai; drives the burn rate |
| Scenario | `scn` | A named set of forecast adjustments |
| Mailbox connection | `mbx` | A user's connected Gmail (encrypted refresh token) |
| Email evidence | `eml` | Metadata and an AI summary of an email that caused an update (never the body) |
| Knowledge source | `ksr` | A connected Google Drive folder of Earth Bank documents (encrypted refresh token) |
| Share link | `shl` | A secret, password-protected link that shows funders a read-only pipeline summary |
| Knowledge document | `kdc` | One file from a knowledge folder with its extracted text; pinned or excluded for AI drafting |
| Change event | `chg` | Every change to a funder or opportunity field, with source (manual, import, AI), evidence and reason |
| Audit log | `aud` | |

- **Core flows**:
    1. See cash, monthly burn, runway date, and progress on each goal at a glance.
    2. Browse and edit funders and opportunities, including stage, amount, expected receipt date and next step.
    3. Add a new inbound funder, either by entering their email or domain or by forwarding their email. The app then backfills that person's past email threads into the funder's timeline.
    4. Plan milestones with tasks: assign, set deadlines, comment, attach files, get email alerts. Make it obvious what each person must do per milestone ("Drew: A, B, C before Jan 1").
    5. Model runway scenarios: slip a funding date, change an amount, add a hire or a one-off cost, and see when OpEx runs out.
    6. Review AI-proposed updates from email, with evidence and reasoning, then accept, revert or override them.
    7. See which funders are waiting on a reply, and have the AI draft it (from the thread, the pipeline and Earth Bank's Drive documents) into the sender's Gmail drafts for review.
- **Public surfaces**: none, apart from `/healthz`, the Google OAuth callback, the inbound-email webhook (signature-verified), and funder share pages (`/share/{secret}`, password-protected; see §10 Sharing).
- **Background work**:
    - Bookeeping.ai sync (hourly): accounts, balances, transactions.
    - Gmail sync per connected user (every 15 min), plus a backfill when a funder is added.
    - AI email classification (Anthropic).
    - Drive knowledge sync (nightly, and on demand).
    - Inbound forwarded-email processing.
    - Notification emails (task assigned, comment written).
    - Nightly backups and hourly cleanup.
- **Decisions locked with the user**:
    - Single host `dashboard.theearthbank.org`; everything requires sign-in.
    - All users are admins.
    - Google sign-in only, `@theearthbank.org` only. No passwords, no invites.
    - Bank data comes from Bookeeping.ai (`docs.bookeeping.ai`), read-only.
    - Only the spreadsheet's Master Pipeline tab is imported in v1.
    - The AI only reads threads with known funder contacts or funder domains, never the whole inbox. It stores a short summary, never the email body.
    - The dashboard may save drafts to a person's Gmail (`gmail.compose`) but never sends email.
    - Drive access is read-only and limited to folders someone explicitly connects; their documents' text is stored (they're Earth Bank's own business documents).
    - The forecast shows two lines: committed money only, and pipeline weighted by an editable probability per stage.
    - AI runs on the Anthropic API.
    - The color scheme matches the Earth Bank loans app (`loans.theearthbank.org`).
- **Out of scope for v1**:
    - Public API, API keys, MCP, marketing site, multi-tenancy.
    - The spreadsheet's Fund Manager Pipeline, Bank & Credit Partners, NYCW Invitees and Fund Scouts tabs (`funder.kind` allows them later).
    - Writing back to Bookeeping.ai; sending email from Gmail.
    - Detecting cold inbound from organizations nobody has added or forwarded (that would mean reading the whole inbox).

---

## 1. Principles

- **One app, one service.** A single Nuxt app (dashboard + `/v1` API) deployed as one Render web service with a persistent disk. Split only when a real constraint forces it.
- **The dashboard uses the `/v1` API.** The UI calls `/v1` handlers same-origin. There are no outside integrators in v1, but the API keeps the same shape so a public API can be added later without a rewrite. No BFF.
- **Boring, durable data.** SQLite in WAL mode on a persistent disk, Prisma for schema and migrations, files on disk behind a small storage interface. Swapping to Postgres + S3 later must stay a contained change.
- **One schema, many uses.** zod schemas in `shared/` validate requests, drive forms, generate OpenAPI components and define AI structured output.
- **Explicit imports, no relative paths.** Every import names its source through an alias (`#root/`, `#server/`, `#shared/`, `~/`). No auto-imports, no `../`.
- **Framework-agnostic server core.** `server/utils/**` and `server/database/**` never import the Nitro runtime, so the same code runs in HTTP handlers, job worker threads, scripts, tests and the Prisma CLI.
- **Loosely coupled functions.** Every function takes one object argument and declares only the properties it uses (see §5).
- **Semantic names everywhere.** Names say what something is or means, never how it looks or where it sits (see §5).
- **Everything resumable.** A disk-backed Render service has brief downtime on deploy. Jobs and long tasks keep their state in the database and are safe to retry.
- **Swappable vendors.** Email, AI, storage and similar dependencies sit behind a small interface with a dev fallback (e.g. email prints to the console when no key is set).
- **Comments explain why**, not what. Pin a decision next to the code it affects ("Migrations run at start: the disk isn't mounted during build").

---

## 2. Stack

### Version policy

- Use the **current LTS release** of anything that has an LTS line (Node first of all), and the **latest stable major** of everything else.
- No pre-releases (`rc`, `beta`, `next` tags) in dependencies.
- When two packages must agree (TypeScript and `vue-tsc`, the Prisma CLI, client and adapter), use the newest version they all support, pin those packages to exactly the same version, and put a comment next to the pin saying why.
- Check versions when the project starts and on each dependency upgrade, not from this document.

### Choices

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node (current LTS), npm | `"type": "module"`; `engines.node` pinned to the LTS major |
| Framework | Nuxt (Nitro, `node-server` preset) | SSR on; file-based pages and server routes |
| Language | TypeScript, `strict` | Newest version `vue-tsc` supports |
| UI kit | `@nuxt/ui` | Includes the dashboard components (MIT) |
| CSS | Tailwind CSS (via Nuxt UI) | Theme tokens in `app/assets/css/main.css` |
| Icons | Lucide via `@iconify-json/lucide` | `i-lucide-*` |
| Fonts | `@nuxt/fonts` (bundled with Nuxt UI), self-hosted | Configure in `nuxt.config.ts` → `fonts.families` |
| Charts | `nuxt-charts` 3.x | Follows Nuxt UI colors and dark mode; `referenceLines` mark thresholds (the runway's $0 line) |
| Composables | `@vueuse/core`, `@vueuse/integrations` (`useSortable` + `sortablejs` for drag-to-reorder) | |
| Database | SQLite (WAL, 5s busy timeout, `foreign_keys = ON`) | `better-sqlite3` driver |
| ORM | Prisma + `@prisma/adapter-better-sqlite3`, exact-pinned together | `prisma.config.ts`, ESM client generated into `server/generated/prisma` |
| Search | SQLite FTS5 via raw SQL | Virtual table created outside Prisma migrate |
| Validation | `zod` | `z.toJSONSchema` for OpenAPI and AI schemas |
| Auth | `google-auth-library` | Sign in with Google only, restricted to the `theearthbank.org` Workspace; our own DB sessions (see §6) |
| Gmail | `@googleapis/gmail` (`gmail.readonly`, `gmail.compose` for drafts) | Same OAuth client as sign-in |
| Google Drive | `@googleapis/drive` (`drive.readonly`) | Knowledge folders for AI drafting; `unpdf`, `read-excel-file`, `mammoth` (.docx) and `fflate` (.pptx) extract text |
| Bank data | Bookeeping.ai public API (`docs.bookeeping.ai`) | Behind `BookkeepingProvider`; read-only, polled |
| Background jobs | `sidequest` + `@sidequest/sqlite-backend` | Separate `jobs.db` file |
| Scheduled work | Nitro tasks (`experimental.tasks`, `scheduledTasks`) | |
| API docs | Nitro `experimental.openAPI` + Scalar | |
| Email | `resend` behind an adapter | Console fallback in dev |
| AI | Provider interface; Anthropic (`@anthropic-ai/sdk`) first | Structured output via JSON Schema (zod → tool input schema) |
| Inbound email | Resend Inbound webhooks | Forwarded funder emails (see §10 Email intelligence) |
| Outbound HTTP | `undici` + an SSRF-safe fetch helper | Never fetch user-supplied URLs without it |
| Images | `sharp` | |
| PDFs (optional) | `@cantoo/pdf-lib` (edit), `unpdf` (text) | `pdf-lib` itself is unmaintained |
| Files | `read-excel-file` (pipeline import) | `archiver`, `csv-stringify` later for exports |
| Tests | Vitest | Node environment |
| Scripts | `tsx` | One-off CLIs in `scripts/` |
| Bundling jobs | `esbuild` | Standalone worker bundle (see §7) |
| Formatting | Prettier | See §5 |
| Hosting | Render: one web service + persistent disk | `render.yaml` blueprint |

---

## 3. Hosting and environments

### Hosts

One host. The template's multi-host layout (marketing, API, public hosts) is dropped: this is an internal tool with no public surface.

| Host | Serves | Auth |
|---|---|---|
| `dashboard.theearthbank.org` | Dashboard (SSR) + same-origin `/v1/**`, `/auth/google/**`, `/webhooks/inbound-email`, `/healthz` | Session cookie (webhook: signature) |

- `server/middleware/00.canonical-host.ts` redirects any other public hostname (e.g. `*.onrender.com`) to `APP_URL`, except `/healthz` so Render's health check still works.
- There are no public pages; every page and `/v1` route requires a session.

### Local development

The app runs on `http://localhost:3000`. Google sign-in works locally once `http://localhost:3000/auth/google/callback` is on the OAuth client's redirect list (see `docs/deploy-runbook.md`).

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run import:pipeline -- "path/to/Earth Bank - Fundraising, Fund Manager, and Contacts.xlsx"
npm run dev
```

`.claude/launch.json` defines a `dev` configuration (`npm run dev`, port 3000).

### Production (Render)

- **One web service** on the current Node LTS, paid plan (needed for the disk and edge caching), persistent disk mounted at `/var/data`.
- **A disk pins the service to one instance** and disables zero-downtime deploys. That's acceptable; it's why jobs must be resumable.
- **Build**: `npm ci && npm run build`. **Start**: `prisma migrate deploy && node .output/server/index.mjs`. Migrations run at start because the disk isn't mounted during build or pre-deploy.
- **Health check**: `GET /healthz` runs `SELECT 1` and returns `{ ok: true }` with `no-store`.
- **Edge caching** set to "All files"; caching is then driven entirely by `Cache-Control` headers the app sends (see §8). Responses with `Set-Cookie` are never cached, so public routes must never touch the session.
- **Secrets** use `sync: false` in `render.yaml` (set in the dashboard); generated secrets use `generateValue: true`.
- **Post-deploy checklist** lives as comments at the top of `render.yaml`: custom domain, edge caching, Google OAuth redirect URI, importing the pipeline. The full steps are in `docs/deploy-runbook.md`.

```yaml
# Render Blueprint — Earth Bank Dashboard
#
# One web service runs everything (HTTP + Sidequest workers + Nitro cron) with
# a persistent disk for SQLite and files. A disk pins the service to a single
# instance and disables zero-downtime deploys; jobs are resumable so a deploy
# restart is safe.
#
# After the first deploy (details in docs/deploy-runbook.md):
#   1. Add the custom domain dashboard.theearthbank.org (CNAME to the service).
#   2. Enable edge caching (Settings → Edge Caching → "All files").
#   3. Add https://dashboard.theearthbank.org/auth/google/callback to the Google
#      OAuth client's redirect URIs (Internal app in the Earth Bank Workspace;
#      Gmail and Drive APIs enabled).
#   4. Sign in with Google (accounts are created on first sign-in), then import
#      the spreadsheet in Settings → Import.
#   Data lives on the disk, never in the repo: deploys only apply new migrations.

services:
    - type: web
      name: earthbank-dashboard
      runtime: node
      plan: standard
      region: oregon
      buildCommand: npm ci && npm run build
      # Migrations run at start: the disk isn't mounted during build/pre-deploy.
      startCommand: npm run start:render
      healthCheckPath: /healthz
      disk:
          name: data
          mountPath: /var/data
          sizeGB: 10
      envVars:
          # Current Node LTS major; keep in step with engines.node.
          - key: NODE_VERSION
            value: "24"
          - key: NODE_ENV
            value: production
          - key: DATA_DIR
            value: /var/data
          - key: APP_URL
            value: https://dashboard.theearthbank.org
          - key: NITRO_RUN_BACKGROUND_WORKERS
            value: "true"
          # Encrypts stored Gmail refresh tokens (AES-256-GCM). Never rotate without re-encrypting.
          - key: APP_ENCRYPTION_KEY
            generateValue: true
          - key: GOOGLE_CLIENT_ID
            sync: false
          - key: GOOGLE_CLIENT_SECRET
            sync: false
          - key: GOOGLE_WORKSPACE_DOMAIN
            value: theearthbank.org
          - key: BOOKEEPING_API_BASE
            value: https://api.bookeeping.ai/public-api
          - key: BOOKEEPING_API_KEY
            sync: false
          - key: ANTHROPIC_API_KEY
            sync: false
          - key: AI_MODEL
            value: claude-opus-5-5
          - key: EMAIL_FROM
            value: Earth Bank Dashboard <noreply@mail.theearthbank.org>
          - key: RESEND_API_KEY
            sync: false
          - key: RESEND_WEBHOOK_SECRET
            sync: false
          - key: INBOUND_EMAIL_DOMAIN
            value: mail.theearthbank.org
          - key: SIDEQUEST_DASHBOARD_USER
            value: admin
          - key: SIDEQUEST_DASHBOARD_PASSWORD
            generateValue: true
```

### Data on disk

Everything persistent lives under `DATA_DIR` (`.data` locally, `/var/data` on Render):

```
DATA_DIR/
    db/app.db        # application database
    db/jobs.db       # Sidequest queue (separate so polling doesn't contend with app writes)
    files/           # uploads, keyed "{kind}/{id}/…" (e.g. tasks/tsk_…/report.pdf); single org, no tenant prefix
    imports/         # spreadsheets uploaded for import:pipeline
    backups/         # nightly VACUUM INTO snapshots, 7 kept
```

### Scaling path (not now)

A `NITRO_RUN_BACKGROUND_WORKERS` flag decides whether a process runs Sidequest workers and Nitro cron. It is `true` on the single service. Moving workers to their own service later means SQLite → Postgres and disk files → S3-compatible storage; Prisma and the storage interface keep that change contained.

---

## 4. Project layout

```
README.md                The only doc at the root (plus agent files: CLAUDE.md / AGENTS.md)
docs/                    Every other doc: SPEC.md, api-guide.md, runbooks, decision notes
app/                     Nuxt frontend
    app.config.ts        Nuxt UI theme + component default variants
    assets/css/main.css  Tailwind + Nuxt UI imports, theme tokens
    components/          PascalCase .vue, grouped by area (pipeline/, tasks/, forecast/)
    composables/         useApi, useAuth, use<Thing>
    layouts/             default (dashboard), auth (login page)
    middleware/          auth.global.ts
    pages/               file-based routes
    utils/               client-side helpers
server/
    database/            Basic CRUD against the database, one file per resource
                         (things.ts: findThing, listThings, createThing, updateThing, …).
                         The only place Prisma queries are written.
    utils/               Generic, reusable functions: db client, config, ids, errors, auth,
                         email, ai, mail (Gmail + inbound), bookkeeping, crypto, jobs,
                         storage, serializers, and the h3 helpers (api.ts, auth.ts).
                         Group by area in subfolders.
                         database/ and utils/ are used by Nitro AND by job worker threads, so
                         they must not import the Nitro runtime (nitropack/runtime,
                         useRuntimeConfig, useStorage); config comes from process.env.
    middleware/          Numbered for order: 00.canonical-host, 01.security-headers, …, 10.auth
    plugins/             Numbered: 00.database, 10.sidequest, 20.openapi
    routes/v1/           REST API, file-based: index.get.ts, [id].patch.ts, [id]/publish.post.ts
    routes/              Non-API routes: healthz, auth/google/*, webhooks/inbound-email
    tasks/               Nitro scheduled tasks
    generated/           Prisma client (git-ignored)
shared/
    schemas/             zod schemas, one file per resource, barrel in index.ts
    constants/           enums and fixed lists shared by app and server (stages, goal types, tiers)
    forecast/            pure runway projection, used by server and client
jobs/                    Sidequest job classes: <name>.job.ts
sidequest.jobs.ts        Barrel exporting every job class
prisma/                  schema.prisma + migrations/
scripts/                 tsx CLIs (import-pipeline, evals, one-off maintenance)
tests/unit/              Pure logic
tests/integration/       Against a throwaway SQLite database
tests/fixtures/
render.yaml
```

### Import aliases

Node subpath imports in `package.json` are the single source of truth. Node, `tsx`, esbuild, Vite/Vitest and Nitro all resolve them, so the same import works in routes, jobs, scripts and tests:

```json
"imports": {
    "#root/*": "./*",
    "#server/*": "./server/*",
    "#shared/*": "./shared/*"
}
```

Rules:

- **Never use relative imports** (`./`, `../`). Server, jobs, scripts and tests use `#server/`, `#shared/` and `#root/`; app code uses Nuxt's `~/` (the `app/` folder) and `#shared/`.
- **Always include the `.ts` extension** on internal imports (`allowImportingTsExtensions` is on). External packages don't take one.
- `#root/` is for files outside `server/` and `shared/`: `#root/jobs/send-email.job.ts`, `#root/sidequest.jobs.ts`.
- If a tool ever fails to pick up the `package.json` imports, mirror the same three entries in `nuxt.config.ts` → `alias` and `vitest.config.ts` → `resolve.alias` rather than falling back to relative paths.

```ts
// Good
import { db } from '#server/utils/db.ts'
import { CreateThingRequest } from '#shared/schemas/index.ts'
import { SendEmailJob } from '#root/jobs/send-email.job.ts'
import { defineEventHandler } from 'h3'

// Bad: relative path
import { db } from '../../utils/db.ts'

// Bad: missing extension
import { db } from '#server/utils/db'
```

### No auto-imports

Nuxt and Nitro auto-imports are turned off. Every function, composable and helper is imported where it's used, so a file's dependencies are visible at the top and the same code reads identically in a job, a script or a test.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    // App: no auto-imported composables, utils or Vue APIs.
    imports: { autoImport: false },
    nitro: {
        // Server: no auto-imported h3 helpers or server/utils exports.
        imports: false,
    },
})
```

Where things come from once auto-imports are off:

| What | Import from |
|---|---|
| `defineEventHandler`, `readBody`, `getQuery`, `setResponseStatus`, `getCookie`, … | `h3` |
| `defineNitroPlugin`, `defineTask`, `defineRouteMeta`, `useRuntimeConfig` | `nitropack/runtime` |
| `ref`, `computed`, `reactive`, `watch`, … | `vue` |
| `definePageMeta`, `navigateTo`, `useRoute`, `useAsyncData`, `useState`, `useSeoMeta`, … | `#imports` |
| Project composables and utils | `~/composables/….ts`, `~/utils/….ts` |

Vue components (yours and Nuxt UI's `U*`) are still registered automatically; they are components, not functions.

---

## 5. Code style

### Formatting

**Prettier, 4-space indentation, no tabs.** Add Prettier as a dev dependency with a `.prettierrc`:

```json
{
    "tabWidth": 4,
    "useTabs": false,
    "semi": false,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 120,
    "arrowParens": "avoid",
    "endOfLine": "lf"
}
```

- TypeScript everywhere, `strict`. `<script setup lang="ts">` in every component.
- Sort imports: external packages first, then aliases (`#root/`, `#server/`, `#shared/`, `~/`).
- Small, named functions over clever one-liners. Early returns.
- Named exports only, except where Nuxt/Nitro require a default (`defineEventHandler`, `defineNitroPlugin`, `defineTask`, pages, layouts).
- Inline comments only for the non-obvious why.
- Log with a bracketed area prefix: `console.info('[jobs] …')`, `console.error('[api] … failed', error)`.
- No barrel files except `shared/schemas/index.ts` and `sidequest.jobs.ts`.

### Functions

**One object argument.** Every function we write takes a single object, destructured in the signature. Adding, removing or reordering a parameter later never breaks a caller, and call sites read like named arguments.

```ts
// Good
assignTask({ taskId, assigneeId, assignedBy })

// Bad: positional arguments
assignTask(taskId, assigneeId, assignedBy)
```

Functions that take nothing (`db()`) take no object. Callbacks whose shape is fixed by someone else (h3's `defineEventHandler(event => …)`, Vue's `computed(() => …)`, `array.map(item => …)`, a vendor SDK) keep the shape they're given.

**Declare only what the function uses.** Parameters are the specific values the function needs, never a whole request body, API payload or database row passed through "just in case". A function coupled to a big type has to change whenever that type does, and it hides which fields actually matter. This matters most around complex third-party APIs (Stripe, Shopify, Spotify), where payload shapes are large and change between versions: pull out the fields at the boundary and pass those.

```ts
// Good: the function says exactly what it needs
createFunder({ name, emailDomains })

// Bad: coupled to the whole request type
createFunder(body as CreateFunderRequest)

// Good: take the fields from the Bookeeping.ai transaction at the boundary
upsertBankTransaction({ externalId: tx.id, amountCents, bookedOn: tx.date, category: tx.category?.name ?? null })

// Bad: the whole vendor payload leaks into our code
upsertBankTransaction(tx)
```

The one exception is a function whose whole job is mapping a record, such as a serializer (`serializeThing({ thing })`).

**Complete JSDoc on every function**, exported or not: a one-line summary, extra context if it's needed, an `@param` for every property of the argument object, `@returns`, and `@throws` when it throws on purpose.

```ts
/**
 * Create a funder and queue a Gmail backfill for its contacts.
 *
 * @param input.name - Organization name; must not already exist (case-insensitive).
 * @param input.emailDomains - Domains whose mail belongs to this funder, e.g. `["ikeafoundation.org"]`.
 * @param input.createdBy - User id of the person adding the funder.
 * @returns The created funder row.
 * @throws ApiError 409 `conflict` when a funder with that name exists.
 */
export async function createFunder({ name, emailDomains, createdBy }: { name: string; emailDomains: string[]; createdBy: string }) {
    // …
}
```

**Where a function lives:**

| Kind | Where | Example |
|---|---|---|
| **Helper function**: used by one route only | Same file as the route, below the handler | `buildPublishSummary` in `[id]/publish.post.ts` |
| **Database function**: basic CRUD for a resource | `server/database/<resource>.ts` | `findThing`, `createThing`, `archiveThing` |
| **Utility**: generic and reused across routes, jobs or scripts | `server/utils/` | `newId`, `parseBody`, `enqueueEmail`, `serializeThing` |

A helper that a second route starts to need moves to `server/utils/` (or `server/database/` if it's a query) at that point, not before.

### Semantic naming

Name things for what they are or what they mean in the product, never for how they look, where they sit, or how they're implemented. If the design or the implementation changes, the name should still be right.

| Kind | Good | Bad |
|---|---|---|
| Variables | `publishedAt`, `pendingInvites`, `isTrialExpired` | `d2`, `list`, `flag`, `tmp` |
| Booleans | `is_`, `has_`, `can_` prefixes: `can_write`, `has_more` | `write`, `more`, `status2` |
| Functions | Verb + object: `publishThing`, `findActiveSession` | `handle`, `doStuff`, `process2` |
| Vue components | Role in the UI: `ThingStatusBadge`, `InviteMemberModal` | `GreenPill`, `LeftBox`, `Modal2` |
| CSS classes | Meaning: `.thing-card__title`, `.is-overdue` | `.blue-text`, `.mt-big`, `.left-col` |
| CSS tokens | Role: `--color-danger`, `--surface-muted` | `--red`, `--gray-2` |
| Endpoints | Resource nouns + action verbs: `POST /v1/things/{id}/publish` | `POST /v1/doThing`, `/v1/thing2` |
| Parameters | Name the thing: `brand_id`, `published_after`, `include_archived` | `id2`, `b`, `filter`, `flag` |
| Events, audit actions | `thing.published`, `member.removed` | `update1`, `changed` |
| Env vars | `PUBLIC_LINK_BASE_URL`, `SESSION_TTL_DAYS` | `URL2`, `TTL` |

Tailwind utility classes in templates are fine; any custom CSS class or token gets a semantic name.

### Casing

- Files and folders in `server/`, `shared/`, `jobs/`, `scripts/`, `tests/`: kebab-case (`api-keys.ts`, `send-email.job.ts`).
- Vue components: PascalCase (`CopyLink.vue`). Composables: `useThing.ts`.
- Server routes: Nitro method suffixes (`index.post.ts`, `[id].delete.ts`).
- TypeScript variables and functions: camelCase. Types, classes, zod schemas: PascalCase (`Thing`, `CreateThingRequest`, `UpdateThingRequest`), with a same-named type via `z.infer`.
- **API and database fields are snake_case** (`created_at`, `funder_id`), so Prisma rows, API JSON and form state look the same. Prisma models are PascalCase and `@@map` to snake_case tables.

---

## 6. Server conventions

### Config

`server/utils/config.ts` reads `process.env` directly (no `useRuntimeConfig`) so it works in every context. It loads `.env` itself for scripts and tests, never overriding existing variables. Values are exposed as getters with local-dev defaults:

```ts
export const config = {
    get appUrl() {
        return env('APP_URL', 'http://localhost:3000')
    },
    get resendApiKey() {
        return env('RESEND_API_KEY')
    },
    // …
}
```

`runtimeConfig.public` in `nuxt.config.ts` only holds what the browser needs (host URLs for cross-links).

### Database

- `db()` in `server/utils/db.ts` returns a lazily created, process-wide Prisma client (better-sqlite3 adapter, 5s timeout). A Nitro plugin runs `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` at boot.
- **Queries live in `server/database/<resource>.ts`**, never inline in routes or jobs. Each file holds the basic CRUD for one resource. There is one organization, so queries take no tenant parameter:

```ts
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Create a funder.
 *
 * @param input.name - Organization name.
 * @param input.emailDomains - Domains whose mail belongs to this funder.
 * @param input.notes - Optional free-text notes.
 * @returns The created funder row.
 */
export function createFunderRow({ name, emailDomains, notes }: { name: string; emailDomains: string[]; notes?: string | null }) {
    return db().funder.create({
        data: { id: newId({ kind: 'funder' }), name, email_domains: emailDomains, notes: notes ?? null },
    })
}

/**
 * Find one non-archived funder.
 *
 * @param input.funderId - The funder's id.
 * @returns The funder row, or null when it doesn't exist or is archived.
 */
export function findFunder({ funderId }: { funderId: string }) {
    return db().funder.findFirst({ where: { id: funderId, archived_at: null } })
}
```
- Schema header comment states the conventions: snake_case fields, IDs generated in app code.
- **IDs**: prefixed, time-sortable strings (ULID layout, Crockford base32), e.g. `usr_01k6x3…`, from `newId({ kind })`. A single `ID_PREFIXES` map in `server/utils/ids.ts` lists every kind. Sorting by id sorts by creation time, which makes cursor pagination cheap.
- Timestamps: `created_at @default(now())`, `updated_at @updatedAt`. Soft delete with `deleted_at` / `archived_at` where users can delete things; a cleanup task purges later.
- Flexible settings go in a `settings Json?` column, validated by zod in app code.
- **Every change to a funder or opportunity field goes through one function** (`applyFieldChanges` in `server/utils/change-events.ts`), which writes the row and its `change_event` rows in one transaction. Manual edits, the import and AI updates all use it, so the Activity log is complete.
- Migrations: `npm run db:migrate` after editing `schema.prisma`. Never edit an applied migration.
- FTS5 (if needed): the virtual table is created idempotently at boot and declared as external tables in `prisma.config.ts` so migrate ignores it; keep the index in sync inside the same transaction as writes.

### API handlers

Every `/v1` route follows the same shape: imports, route meta, the handler, then any helper functions used only by this route.

```ts
import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createFunderRow } from '#server/database/funders.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import type { AuthActor } from '#server/utils/auth.ts'
import { requireUser } from '#server/utils/auth.ts'
import { enqueueFunderBackfill } from '#server/utils/jobs/enqueue.ts'
import { serializeFunder } from '#server/utils/serializers/funders.ts'
import { CreateFunderRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Create a funder',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateFunderRequest' } } },
        },
        responses: {
            201: {
                description: 'Funder created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Funder' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateFunderRequest })
    const funder = await createFunderRow({ name: body.name, emailDomains: body.email_domains, notes: body.notes })
    await auditFunderCreated({ event, actor: ctx.actor, funderId: funder.id, name: body.name })
    await enqueueFunderBackfill({ funderId: funder.id })
    setResponseStatus(event, 201)
    return serializeFunder({ funder })
})

/**
 * Record the creation of a funder in the audit log.
 *
 * Helper function: only this route uses it, so it lives here, below the handler.
 *
 * @param input.event - The request, for the caller's IP.
 * @param input.actor - The user who created it.
 * @param input.funderId - Id of the created funder.
 * @param input.name - Name it was created with.
 * @returns Resolves once the entry is written.
 */
async function auditFunderCreated({
    event,
    actor,
    funderId,
    name,
}: {
    event: H3Event
    actor: AuthActor
    funderId: string
    name: string
}) {
    await recordAudit({
        actor,
        action: 'funder.created',
        entityType: 'funder',
        entityId: funderId,
        changes: { name },
        ip: requestIp({ event }),
    })
}
```

- `defineApiHandler` (in `server/utils/api.ts`) sets `cache-control: private, no-store` and maps errors: `ApiError` → its status, `ZodError` → 422 with `details: [{ path, message }]`, h3 4xx → passthrough, anything else → logged 500.
- **Return plain objects.** h3 JSON-encodes whatever a handler returns (and sets `content-type: application/json`), so never call `JSON.stringify` or `send` yourself.
- Error shape is always `{ error: { code, message, details? } }`. Helpers in `server/utils/errors.ts`: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooManyRequests`. Error `code`s are semantic snake_case strings (`invalid_api_key`, `validation_error`).
- `parseBody` / `parseQuery` validate with shared zod schemas.
- **Serializers** per resource (`serializeThing({ thing })`, in `server/utils/serializers/`) define the public shape. This is separate from JSON encoding: a serializer chooses which fields go out, so internal columns (`refresh_token_encrypted`, `token_hash`, storage paths, `deleted_at`) never leak and a new column isn't public until it's added on purpose. It also turns stored values into API values (storage paths → public URLs, JSON columns parsed and defaulted through zod) and adds computed fields (counts, flags). Never return a raw Prisma row.
- Lists return `{ data, next_cursor, has_more }` (`listOf(Item)` in `shared/schemas/common.ts`), cursor = last id.
- A catch-all `server/routes/v1/[...path].ts` returns the JSON 404 instead of an HTML page.
- Every mutation writes an **audit log** entry (actor, action `thing.verb`, entity, changes, IP).
- Client IP: right-most `X-Forwarded-For` entry (the one Render's proxy added).

### OpenAPI

- Nitro `experimental.openAPI` with `production: 'runtime'`, the full document at `/_openapi.json` and Scalar at `/_scalar` (signed-in users only). `docs/api-guide.md` is read into `openAPI.meta.description`.
- Route meta only accepts static literals, so routes reference `#/components/schemas/<Name>`. A Nitro plugin fills `components.schemas` from the `openapiSchemas` map in `shared/schemas/index.ts` via `z.toJSONSchema`, and adds tags and security schemes.
- A unit test fails if any `/v1` route lacks `defineRouteMeta`.

### Auth

**Sign in with Google is the only way in, and the only way to get an account.** There are no passwords, invites, password resets or API keys. Who has access is decided in Google Workspace.

- **Google OAuth client**: one client in the Earth Bank Workspace's Google Cloud project, consent screen set to **Internal** (only Workspace accounts can use it, and the restricted `gmail.readonly` scope needs no Google verification). `google-auth-library`'s `OAuth2Client` handles both sign-in and Gmail.
- **Sign-in flow**:
    1. `GET /auth/google?redirect=/…` stores `state`, a PKCE verifier and the same-site redirect in a short-lived signed cookie, then redirects to Google with scopes `openid email profile` and `hd=theearthbank.org` (a hint only; never trust it alone).
    2. `GET /auth/google/callback` checks `state`, exchanges the code, and verifies the ID token (`verifyIdToken` with our client id as audience).
    3. It requires **all** of: `email_verified === true`, `hd === GOOGLE_WORKSPACE_DOMAIN`, and the email ending in `@theearthbank.org`. Anything else returns to `/login?error=wrong_account` ("Use your @theearthbank.org Google account").
    4. It upserts the `User` by `google_sub` (unique), refreshing name, email and avatar; rejects users with `deactivated_at`; creates a session; and redirects.
- **Accounts**: created on first sign-in with role `admin` (every user is an admin in v1; the `role` column stays for later). Drew, Leslie and Steve get accounts by signing in; there is no bootstrap script.
- **Sessions**: our own `session` table. The cookie (`earthbank_dashboard_session`) holds an opaque ~256-bit token; the database stores only its SHA-256. `httpOnly`, `sameSite: lax`, `secure` in production, host-only. Sessions expire after `SESSION_TTL_DAYS` (default 7), so someone removed from Workspace loses access within a week at most; signing in again is one click while their Google session is live.
- **Removing access**: remove the person in Google Workspace, and deactivate them in Settings → Team (`deactivated_at`), which deletes their sessions and mailbox connection immediately.
- **Gmail and Drive are incremental authorization**: sign-in never asks for mail or file access. Settings → Email → "Connect Gmail" re-runs OAuth with `gmail.readonly` and `gmail.compose`; Settings → Knowledge → "Connect folder" with `drive.readonly` (the folder id rides in the encrypted OAuth state). Both use `access_type=offline`, `prompt=consent` and `include_granted_scopes=true`. Refresh tokens are stored in `mailbox_connection` and `knowledge_source`, encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` (`server/utils/crypto.ts`). Revoking any token at Google revokes the person's whole grant, so disconnecting deletes the row and revokes only when nothing else of theirs still uses it (`revokeGoogleAccessIfUnused`).
- `server/middleware/10.auth.ts` resolves the session cookie into `event.context.auth` (`AuthContext`). Routes use `requireUser({ event })` (and `requireRole({ event, minimum: 'admin' })` once roles matter) from `#server/utils/auth.ts`.
- **CSRF**: every non-GET request must carry an `Origin` matching `APP_URL`, except the signature-verified inbound webhook.
- Compare secrets with `timingSafeEqual`.
- **Other secrets** (OAuth state, share-link tokens): opaque random tokens, stored hashed.

### Security baseline

- `01.security-headers.ts`: `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, a restrictive `permissions-policy`, HSTS in production.
- Request size limits in middleware.
- Any server-side fetch of a user-supplied URL goes through `safeFetch` (blocks private/loopback addresses, follows redirects manually, enforces a size cap).
- Storage keys are resolved under the storage root and rejected if they escape it.
- Redirect targets from query strings must match `/^\/(?![/\\])/` (same-site paths only).
- The email adapter refuses the console fallback when `NODE_ENV=production`, so task and comment content never ends up in production logs.
- Never log email bodies, Gmail tokens or AI prompts that contain email content. Log message ids only.
- Verify the Resend webhook signature (`RESEND_WEBHOOK_SECRET`) before reading an inbound email.

### Vendor adapters

Each external service gets a tiny interface in `server/utils/<area>/` plus a registry function that picks the implementation from config:

- **Email** (`server/utils/email/`): `EmailProvider { name, send({ to, subject, html, text }) }`, `ResendProvider`, `ConsoleProvider` (dev). Messages always have `html` and `text`. Sending happens in a job, never inline in a request.
- **AI** (`server/utils/ai/`): `AiProvider { completeStructured({ instructions, prompt, schema }) }`, chosen by `AI_PROVIDER` (default `anthropic`) / `AI_MODEL` (default `claude-opus-5-5`; set a cheaper model such as `claude-haiku-5-5` here if volume makes cost matter). `AnthropicProvider` uses `@anthropic-ai/sdk`'s `beta.messages.parse` with structured outputs (`output_config.format` from a zod schema; Opus 5.5 rejects forced tool use), low effort, and server-side refusal fallbacks (`fallbacks: "default"`). The result is range-checked after parsing. Instructions live in `server/utils/ai/instructions.ts` (TypeScript strings rather than Markdown files, so they bundle into Nitro and the job workers without file reads). `npm run eval:classify-email` scores the classifier against labelled fixtures.
- **Bookkeeping** (`server/utils/bookkeeping/`): `BookkeepingProvider { listAccounts(), getAccountBalance({ accountId }), listTransactions({ since, cursor }) }`. `BookeepingAiProvider` calls `BOOKEEPING_API_BASE` with `Authorization: Bearer BOOKEEPING_API_KEY` and backs off on 429 (limits: 100 reads/min, 6,000/day). `FixtureProvider` serves JSON fixtures in dev when no key is set. There are no webhooks, so we poll.
- **Mailbox** (`server/utils/mail/`): `GmailMailbox` over `@googleapis/gmail` (search, headers, messages, threads, `createDraft`), consumed through narrow types (`MailboxReader` for sync, `ThreadReader` for drafting) so tests pass fakes.
- **Knowledge** (`server/utils/knowledge/`): `KnowledgeDrive { getFolder, listFiles, exportFile, downloadFile }`, implemented by `GoogleKnowledgeDrive`; `extract.ts` turns files into text; `select.ts` chooses what the AI reads. `parseInboundEmail({ payload })` turns a Resend Inbound webhook payload into the same normalized `IncomingEmail { messageId, from, to, cc, date, subject, text }`, unwrapping the forwarded original where possible.
- **Storage** (`server/utils/storage.ts`): `putFile({ key, data })`, `readStoredFile({ key })`, `streamFile({ key })`, `fileExists({ key })`, … over relative keys. Local disk now; S3/R2 later.

---

## 7. Background jobs and scheduled tasks

### Sidequest jobs

- One class per job in `jobs/<name>.job.ts`, extending `Job` with a `run(params)` method. Params are plain JSON (usually just an id); the job loads state from the database so it's idempotent and resumable.
- Every job class is exported from `sidequest.jobs.ts`. **Never rename a job class** while jobs of that name may be queued; re-export the old name as an alias.
- Jobs only import from `#server/utils/**`, `#server/database/**` and `#shared/**`.
- Enqueue through typed helpers in `server/utils/jobs/enqueue.ts` that set queue, attempts and timeout:

```ts
import { SendEmailJob } from '#root/jobs/send-email.job.ts'
import { Sidequest } from '#server/utils/jobs/sidequest.ts'

/**
 * Queue one transactional email; retried up to 5 times on provider errors.
 *
 * @param input.to - Recipient address.
 * @param input.subject - Subject line.
 * @param input.html - HTML body.
 * @param input.text - Plain-text body.
 * @returns The queued Sidequest job.
 */
export function enqueueEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
    return Sidequest.build(SendEmailJob).queue('email').maxAttempts(5).enqueue({ to, subject, html, text })
}
```

- Queues have small, explicit concurrency (SQLite has one writer): e.g. `email` 2, `default` 2, a slow/expensive queue 2.
- `manualJobResolution: true`: worker threads import a standalone esbuild bundle of `sidequest.jobs.ts`. In production the Nitro `compiled` hook writes it to `.output/server/sidequest.jobs.mjs`; in dev a plugin rebuilds it into `.nuxt/` on start. esbuild resolves the `#` aliases from `package.json`. Native modules, Prisma and Sidequest are external; `keepNames: true` because jobs resolve by class name.
- Set `nitro.externals.trace: false`: Sidequest loads its driver, migrations and dashboard from disk at runtime, which tracing misses. Render runs `.output` from the build checkout, so packages resolve from `node_modules`.
- The Sidequest dashboard runs with basic auth and is proxied at `/admin/jobs` for signed-in users.
- `Sidequest.start()` when `NITRO_RUN_BACKGROUND_WORKERS` is true, else `Sidequest.configure()` (enqueue only). Stop on Nitro `close`.

### Nitro tasks

Declared in `nitro.scheduledTasks` (cron, UTC; comment any timezone math). Each task imports `defineTask` from `nitropack/runtime` and returns early with `'skipped (workers disabled on this instance)'` when workers are off. Defaults for every project:

| Task | When | Does |
|---|---|---|
| `cleanup` | hourly | Expired sessions and OAuth states; purge files of soft-deleted rows past retention |
| `backup` | nightly | `VACUUM INTO` snapshots of `app.db` and `jobs.db` into `DATA_DIR/backups`, keep 7 |
| `bookkeeping-sync` | hourly | Enqueue `SyncBookkeepingJob`: accounts, today's balance snapshot, new transactions |
| `mail-sync` | every 15 min | Enqueue one `SyncMailboxJob` per connected mailbox |
| `knowledge-sync` | nightly 04:30 | Enqueue one `SyncKnowledgeJob` per connected Drive folder |
| `task-digest` | weekdays 13:00 UTC (morning US time) | Optional: email each user their tasks due in the next 7 days |

---

## 8. Caching

Set headers explicitly; the CDN does what they say.

| Path | Cache-Control |
|---|---|
| `/_nuxt/**` and other content-hashed assets | `public, max-age=31536000, immutable` |
| `/v1/**`, dashboard HTML, `/auth/**`, `/webhooks/**` | `private, no-store` |
| `/healthz`, 404s | `no-store` |

Static rules go in `routeRules`. Everything except hashed assets is private, so the CDN caches nothing else.

---

## 9. Frontend conventions

### Nuxt UI setup

- `nuxt.config.ts`: `modules: ['@nuxt/ui', 'nuxt-charts']`, `css: ['~/assets/css/main.css']`, `ui.theme.colors` lists the semantic colors (`primary`, `secondary`, `success`, `info`, `warning`, `error`, `neutral`), one Google font via `fonts.families` (self-hosted), favicon SVG + apple-touch-icon in `app.head`.
- **Theme matches the Earth Bank loans app** (`loans.theearthbank.org`, read from its live CSS), so both apps feel like one product:
    - `app.config.ts` → `ui.colors`: `primary: 'green'`, `secondary: 'blue'`, `info: 'blue'`, `success: 'green'`, `warning: 'yellow'`, `error: 'red'`, `neutral: 'zinc'`.
    - Font **Public Sans** via `fonts.families`; `--ui-radius: 0.25rem`.
    - Light: `--ui-primary: var(--ui-color-primary-700)`, `--ui-bg: var(--ui-color-neutral-50)`, `--ui-bg-muted: var(--ui-color-neutral-100)`, `--ui-text-inverted: var(--ui-color-neutral-50)`.
    - Dark: `--ui-primary: var(--ui-color-primary-400)`, `--ui-bg: var(--ui-color-neutral-900)`, `--ui-bg-muted: var(--ui-color-neutral-800)`, `--ui-text-inverted: var(--ui-color-neutral-900)`.
- `app.config.ts` also sets `defaultVariants` so the app has one consistent look (e.g. `variant: 'soft'` on buttons, badges and every input type). Component slot overrides go here too.
- Use Nuxt UI's semantic colors (`color="error"`, `text-muted`, `bg-elevated`) rather than raw palette colors (`text-red-500`), so theming and dark mode follow automatically.
- `main.css`:

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme {
    --font-sans: 'Public Sans', sans-serif;
}

/* Tokens copied from the Earth Bank loans app so the two products match. */
:root,
.light {
    --ui-radius: 0.25rem;
    --ui-primary: var(--ui-color-primary-700);
    --ui-bg: var(--ui-color-neutral-50);
    --ui-bg-muted: var(--ui-color-neutral-100);
    --ui-text-inverted: var(--ui-color-neutral-50);
}

.dark {
    --ui-primary: var(--ui-color-primary-400);
    --ui-bg: var(--ui-color-neutral-900);
    --ui-bg-muted: var(--ui-color-neutral-800);
    --ui-text-inverted: var(--ui-color-neutral-900);
}

/* Tailwind v4 dropped the pointer cursor on buttons; restore it for every interactive control. */
@layer base {
    button:not(:disabled),
    [role="button"]:not([aria-disabled="true"]),
    [role="switch"]:not([aria-disabled="true"]),
    [role="tab"]:not([aria-disabled="true"]),
    [role="option"]:not([aria-disabled="true"]),
    [role="menuitem"]:not([aria-disabled="true"]),
    select:not(:disabled) {
        cursor: pointer;
    }
}
```

- Dark mode is supported from day one, using the light/dark tokens above.
- Dashboard layout uses Nuxt UI's dashboard components (`UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`). The sidebar nav is defined in one constant (`app/utils/navigation.ts`), so adding a page later means adding a route and one nav entry: Overview, Pipeline, Forecast, Milestones & Tasks, Activity, Settings.
- **Dates follow the viewer's time zone.** The browser stores its zone in the `earthbank_dashboard_tz` cookie (`app/plugins/time-zone.ts`), so server-rendered pages and the server's "today" (`requestToday`) use it; `formatDate` shows moments in that zone. Calendar dates (deadlines, expected dates) are the same day everywhere. Work with no browser (emails, digests) uses `APP_TIME_ZONE`.
- **Tables**: every `UTable` passes its columns through `sortableColumns` (`app/utils/table-sorting.ts`), so clicking a header sorts by it. Columns whose cell isn't a plain value give an `accessorFn` returning the sort value (stages and relationships in pipeline order); `enableSorting: false` opts out.
- Money is stored as integer cents (`amount_cents`) in USD and formatted in the client with one `formatMoney({ cents })` helper; compact form (`$1.5M`) on charts and tiles.

### Data fetching

- `useApi()` (`~/composables/useApi.ts`) returns a fetcher bound to `/v1`, called as `api({ path, method, body, query })`, that forwards cookies during SSR (`useRequestFetch`). Pages use it inside `useAsyncData` for reads and directly for mutations.
- `apiErrorMessage({ error, fallback })` turns the API error shape into a user-facing message (first validation detail, else the message).
- Downloads (task attachments) are plain `/v1/attachments/{id}/download` links; the session cookie authorizes them.

### Forms

`UForm` with the **same zod schema** the server validates against. With auto-imports off, everything is imported explicitly:

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, ref } from 'vue'
import type { z } from 'zod'
import { navigateTo, useSeoMeta } from '#imports'
import { CreateFunderRequest } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

useSeoMeta({ title: 'New funder · Earth Bank Dashboard' })

const api = useApi()
const funder = reactive({ name: '', contact_email: '', email_domains: [] as string[] })
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)

/**
 * Create the funder with the validated form values, then open its page.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event carrying the zod-validated form data.
 * @returns Resolves after navigation, or once the error message is shown.
 */
async function submitFunder(event: FormSubmitEvent<z.output<typeof CreateFunderRequest>>) {
    errorMessage.value = null
    isSubmitting.value = true
    try {
        const created = await api({ path: '/funders', method: 'POST', body: event.data })
        await navigateTo(`/pipeline/funders/${created.id}`)
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSubmitting.value = false
    }
}
</script>
```

### Routing and auth

- `app/middleware/auth.global.ts` loads `/v1/auth/me` once and redirects to `/login?redirect=…` when signed out. Only `/login` declares `public: true` in page meta (on `#app`'s `PageMeta`). The login page has one "Sign in with Google" button linking to `/auth/google?redirect=…`, and shows the `wrong_account` error when present.
- Layouts: `default` (dashboard), `auth` (login).
- `useSeoMeta` on every page; title format `Page · Earth Bank Dashboard`.
- Page paths are semantic and readable (`/pipeline`, `/pipeline/funders/{id}`, `/milestones`, `/forecast`, `/activity`, `/settings/team`), never internal names or numbers.

---

## 10. Optional modules

Module choices for this product:

- **Multi-tenancy**: not used. One organization, so there is no `company` table, no `company_id` scoping and no tenant headers. Queries in `server/database/` take no tenant parameter.
- **Public API + MCP**: not used in v1. `/v1` keeps the public-API shape so it can be opened up later.
- **Usage analytics**: not used.
- **Exports**: later (CSV of the pipeline is the likely first one).
- **Email intelligence**: used; described below.

### Email intelligence

Keeps funder and opportunity status current from email, without the AI ever seeing private mail.

- **What gets read**: only messages to or from a known contact's address or a funder's `email_domains`. Free-mail domains (gmail.com, outlook.com, …, listed in `shared/constants/free-mail-domains.ts`) match by exact address only. Earth Bank's own domains (the Workspace domain plus `INTERNAL_EMAIL_DOMAINS`, e.g. `resolvefund.org`) can never be a funder contact or domain, so staff mail is never attributed to a funder. The whole inbox is never scanned or sent to the AI.
- **Gmail sync** (`SyncMailboxJob`, every 15 min per connected mailbox): builds Gmail search queries from contacts and domains (batched, because queries have a length limit) with `after:` set to the last sync minus a day (90 days on the first sync), and skips emails whose RFC Message-ID is already in `email_evidence`, so the same email in two inboxes is read once. Gmail search does the filtering, so non-funder mail is never fetched (no `historyId` scan of the whole inbox).
- **Backfill** (`BackfillFunderJob`): when a funder is created, or a contact or domain is added, search each connected mailbox for `from:/to:{address or @domain} newer_than:12m` and classify the results.
- **Forwarding**: forward to `dashboard@theearthbank.org` (see Instructions by email). A forward with no note above it is classified with source `ai_forward`; if the sender matches no funder, the AI proposes a **draft funder** (contact, domain, goal type, opportunity) that waits as "Needs review" on Activity; confirming it runs the backfill. (Per-person private `updates+token@` addresses were removed: mail must come from an Earth Bank account and pass DMARC/DKIM.)
- **Instructions by email** (`server/utils/mail/instructions.ts`): the team emails `dashboard@theearthbank.org` (`DASHBOARD_EMAIL_ADDRESS`; a Workspace routing rule or Google Group passes it to `dashboard@INBOUND_EMAIL_DOMAIN`). The body (whatever the sender wrote above any forwarded message) is the request; with an empty body, the subject line is (never a forward's subject) ("Add this funder", "Update UBS to approved"). The sender must be an active user (From, or `X-Original-Sender` / `Reply-To` when a Google Group rewrote From) and the mail must pass DMARC or DKIM for an Earth Bank domain per `Authentication-Results`. The AI runs a tool loop (`AiProvider.runWithTools`: find, create and update funders, opportunities, contacts and tasks) as that user, writing changes through `applyFieldChanges` with source `ai_instruction` (treated like a manual edit). Text in a forwarded message is context, never instructions. Each email is carried out once (`email_instruction.processed` audit entry), and the sender gets a reply listing what changed. A forward with no note goes through the funder-matching flow above.
- **Classification** (`ClassifyEmailJob`): the subject and body, trimmed and with quoted replies and signatures stripped, go to the AI. It returns `{ funder_id, opportunity_id?, proposed_changes: [{ field, to }], last_contact_at, summary, reason, confidence, is_sensitive }`, validated by zod. Fields it may change: opportunity `stage`, `amount_cents`, `expected_decision_at`, `expected_receipt_at`, `next_step`; funder `last_contact_at`, `relationship_status`; new contacts.
- **What is stored** (`email_evidence`): Gmail or inbound message id, from, date, subject, mailbox owner, and the AI summary (≤ 300 characters). **Never the body.** When the AI flags `is_sensitive` (personal, HR, legal, salary, health), the subject is hidden and the summary is limited to the funding fact.
- **Applying changes**: a change is applied automatically when confidence ≥ 0.8 and it is not a move to `lost` or an amount decrease; otherwise it becomes a pending suggestion. Each applied or pending change writes a `change_event` with `source`, `evidence_id`, `reason` and `confidence`.
- **Review and override** (Activity page): every AI change shows the evidence summary, the reasoning and the confidence, with **Accept** (pending), **Revert** and **Edit**. A manual edit outranks AI: the AI won't change that field again based on mail older than the manual edit. A pending suggestion is **superseded** ("Out of date") when a newer email's suggestion or any newer applied change (by email date, or edit time; imports don't count) touches the same field, or the field already has that value (`supersedeStaleSuggestions`, run on every change, on Accept, at boot and hourly). Accept refuses an out-of-date suggestion with a 409.
- **Evals**: `npm run eval:classify-email` scores the classifier against local, git-ignored fixtures in `tests/fixtures/emails/`.
- **Stages and their rules**: identified, in discussion, proposal, due diligence, in committee, approved (stored as `committed`), received, declined (stored as `lost`). `server/utils/stage-rules.ts` runs after any applied stage change except imports: moving to approved sets `expected_receipt_at` to 60 days after the approval day (the email's date for AI changes, the editor's today otherwise) unless the same change gives a date; moving to in committee records `committee_on`. An opportunity in committee counts as at least 80% likely (`COMMITTEE_MIN_PROBABILITY`), whatever its override or the team setting.
- **Grants vs lending capital**: Pipeline has a Design Grants tab (design grants and OpEx; design grants are what fund OpEx, so no separate OpEx summary is shown) and a Lending Capital tab (years). Each tab shows every ask, with no filters, declined asks last. The top of each Pipeline tab's Opportunities view shows each funder's ask as a bar grouped by stage (furthest along first) beside a donut of the total by stage (`PipelineStageOverview`); the Funders view shows the geographic coverage map above the list. Cash flow (the runway forecast) counts design grants only (`include_goal_types` defaults to `['design_grant']`; editable in Settings → Cash); lending capital has its own quarterly chart on Forecast.
- **Geographic focus**: each opportunity has `focus_areas`: ISO country codes, regions (`region:eastern_africa`, from `shared/constants/regions.ts`, generated once from the UN subregions in the world-countries dataset) or `global`. Opportunities with no focus yet take it from their funder's spreadsheet "Geo Focus" text (`focusCodesFromText`: "Africa, India" → Africa + India; "EM" → the Emerging markets region), filled once at import and at boot, never over a focus someone set or cleared (`fillFocusAreasFromGeoFocus`). The coverage map (Pipeline → Funders) shades countries by the money asked for them (an ask counts in full for each country it covers; Global asks are listed, not painted).
- **Funder emails**: the funder page lists every email the dashboard has read with that funder (sent or received, the other party, subject unless sensitive, the AI summary, how many pipeline changes it caused) with an "Open in Gmail" link that searches the viewer's own Gmail by Message-ID. Bodies are still never stored.
- **Sync progress**: `mailbox_connection` records the running sync (`sync_state` queued/running, `sync_phase` searching/checking/reading, done/total) and the last result; Settings → Email polls it every 2 seconds while a sync is active. A sync that hasn't reported for 20 minutes is shown as finished (it was interrupted; its retry reports again).
- **Reply needed**: a funder whose latest relevant email is from them (not an Earth Bank domain) has `awaiting_reply_since` set, shown on the pipeline and funder page.
- **Drafting** (`server/utils/mail/draft-reply.ts`): `POST /v1/funders/{id}/reply-draft` finds the latest thread with the funder in the author's own Gmail (same funder search, last 12 months), reads up to 10 messages live, and sends them with the pipeline record, the author's guidance (default: the opportunity's next step) and the selected Drive documents to the AI (`DRAFT_REPLY_INSTRUCTIONS`, effort medium). Thread text is labelled as data, not instructions. Recipients (reply-all minus the author, their aliases and forwarding addresses) and the subject are computed in code; the AI writes the body, "before sending" notes and which documents it used. Nothing from the thread or the draft is stored; the audit log records only that a draft was made. `POST /v1/mailbox/drafts` saves the edited email to Gmail drafts in the thread (`In-Reply-To`/`References`); the person sends it from Gmail.

### Sharing with funders

- Settings → Sharing creates **share links**: `/share/{token}` plus a password. The token is 256 random bits, stored hashed (and encrypted so Settings can show the link again); the password is hashed with scrypt (`server/utils/passwords.ts`) for checking, and also kept encrypted so the team can see and copy it in Settings (it's meant to be sent to funders, not kept from the team). Turning a link off (`revoked_at`) stops it at once.
- `POST /v1/shared/{token}/unlock` checks the password (10 wrong tries per link per 15 minutes, in memory) and sets a signed, per-link, httpOnly cookie for 12 hours; `GET /v1/shared/{token}` then returns the summary. Neither needs a session.
- The summary (`buildSharedPipeline`) has Design Grants (design grants + OpEx) and Lending Capital, each ask with only: funder name, contact **names**, geographic focus names, amount, stage, and (if the link allows) the first sentence of the next step. Declined asks and draft or archived funders are left out. Never emails, notes, owners, probabilities or AI reasoning. The page reuses `PipelineStageOverview` with no links into the dashboard; every response is `noindex`.

### Knowledge (Google Drive)

- Settings → Knowledge connects Drive folders by link. `SyncKnowledgeJob` lists each folder (subfolders included, capped at 500 files), downloads only new or changed files, and stores their text: Google Docs and Slides exported as text, Sheets and .xlsx with every tab, Word .docx via `mammoth`, PowerPoint .pptx (slide text and speaker notes, unzipped with `fflate`), PDFs via `unpdf`, plain text/CSV/Markdown. Old binary .doc/.ppt files and images are listed as "Not readable"; files of a type that becomes readable are retried on the next sync. Files over 20 MB or failed exports are recorded with their status.
- People can **pin** a document (always given to the AI in full) or **exclude** it (never given).
- For each draft, `selectKnowledge` includes every usable document when they total under ~300k characters, in a stable order so the reference block is prompt-cached; otherwise pinned documents plus the best-matching passages (BM25 over ~1,500-character chunks) up to the budget.

---

## 11. Testing

- `vitest.config.ts`: `include: ['tests/**/*.test.ts']`, `environment: 'node'`. Vitest resolves the `#` aliases from `package.json`; tests import with them like any other file (`#server/utils/ids.ts`), never relative paths.
- **Unit tests** for pure logic in `server/utils` and `shared` (runway projection, scenario adjustments, burn calculation, spreadsheet parsing, email-to-funder matching, id generation, OpenAPI coverage).
- **Integration tests** create a temp dir, point `DATA_DIR` and `DATABASE_URL` at it, run `npx prisma migrate deploy`, then dynamically import `#server/utils/…` modules. Mock `#server/utils/jobs/enqueue.ts` to capture emails and jobs instead of running them; mock outbound fetches. Clean up in `afterAll`.
- Name the test file after the behaviour (`google-sign-in.test.ts`, `runway-projection.test.ts`) and start it with a one-line comment saying what it covers.
- Large or private fixtures (the real pipeline spreadsheet, real emails) are git-ignored and copied in locally.
- `npm run typecheck` and `npm test` pass before every commit.

---

## 12. Files to start with

### `package.json` (excerpt)

```json
{
    "type": "module",
    "engines": {
        "node": ">=24 <25"
    },
    "imports": {
        "#root/*": "./*",
        "#server/*": "./server/*",
        "#shared/*": "./shared/*"
    },
    "scripts": {
        "dev": "nuxt dev",
        "build": "nuxt build",
        "start": "node .output/server/index.mjs",
        "start:render": "prisma migrate deploy && node .output/server/index.mjs",
        "preview": "nuxt preview",
        "postinstall": "nuxt prepare && prisma generate",
        "db:migrate": "prisma migrate dev",
        "typecheck": "nuxt typecheck",
        "test": "vitest run",
        "test:watch": "vitest",
        "format": "prettier --write .",
        "import:pipeline": "tsx scripts/import-pipeline.ts",
        "eval:classify-email": "tsx scripts/eval-classify-email.ts"
    }
}
```

`engines.node` and Render's `NODE_VERSION` both track the current Node LTS major.

### `.env.example`

```bash
# Local development defaults. Copy to .env.
APP_URL=http://localhost:3000

# Persistent data (SQLite files, uploads). Render: /var/data
DATA_DIR=.data
SESSION_TTL_DAYS=7

# Google sign-in + Gmail (Internal OAuth app in the Earth Bank Workspace).
# Add http://localhost:3000/auth/google/callback as a redirect URI.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_WORKSPACE_DOMAIN=theearthbank.org

# Encrypts stored Gmail refresh tokens. Generate with: openssl rand -base64 32
APP_ENCRYPTION_KEY=

# Bank data (Bookeeping.ai). Without a key, fixtures in tests/fixtures/bookkeeping are used.
BOOKEEPING_API_BASE=https://api.bookeeping.ai/public-api
BOOKEEPING_API_KEY=

# AI (Anthropic). Without a key, email classification is skipped.
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-5-5
ANTHROPIC_API_KEY=

# Email (Resend). Without a key, emails are logged to the console.
RESEND_API_KEY=
EMAIL_FROM="Earth Bank Dashboard <noreply@mail.theearthbank.org>"

# Inbound forwarded email (Resend Inbound).
INBOUND_EMAIL_DOMAIN=mail.theearthbank.org
# Where the team emails instructions; Google routes it on to dashboard@INBOUND_EMAIL_DOMAIN.
DASHBOARD_EMAIL_ADDRESS=dashboard@theearthbank.org
RESEND_WEBHOOK_SECRET=

# Background workers (Sidequest + Nitro cron) run in this process.
NITRO_RUN_BACKGROUND_WORKERS=true
SIDEQUEST_DASHBOARD_USER=admin
SIDEQUEST_DASHBOARD_PASSWORD=change-me
```

### `.gitignore`

```
node_modules
.nuxt
.output
.nitro
.cache
.data
dist
logs
*.log
.env
.env.*
!.env.example
.DS_Store
server/generated
```

### `nuxt.config.ts` essentials

- `compatibilityDate` set to the project start date.
- `imports: { autoImport: false }` and `nitro.imports: false` (see §4).
- `routeRules` for `/_nuxt/**` (immutable) and `/v1/**`, `/auth/**`, `/webhooks/**` (`private, no-store`).
- `nitro.preset: 'node-server'`, `experimental: { openAPI: true, tasks: true }`, `scheduledTasks`, `openAPI` config, `externals.trace: false`, and the `compiled` hook that writes the jobs bundle.
- `typescript.tsConfig.compilerOptions.allowImportingTsExtensions: true` (needed for `.ts` import extensions, and the Prisma client is generated as TypeScript with `.ts` imports).

### `tsconfig.json`

```json
{
    "files": [],
    "references": [
        { "path": "./.nuxt/tsconfig.app.json" },
        { "path": "./.nuxt/tsconfig.server.json" },
        { "path": "./.nuxt/tsconfig.shared.json" },
        { "path": "./.nuxt/tsconfig.node.json" }
    ]
}
```

---

## 13. Documentation

- **`README.md` lives at the root** and is the only doc there (agent instruction files like `CLAUDE.md` / `AGENTS.md` sit beside it). It covers a one-paragraph pitch, feature list, stack line, local setup (including the Google OAuth redirect URI), project layout, commands, and a pointer to deploy notes.
- **Everything else lives in `docs/`**:
    - `docs/build-plan.md`: the phased delivery plan with a checklist per phase. Tick items off as they land; this is the "implementation status".
    - `docs/SPEC.md`: optional. §0 of this file is the product spec; split it out only if it outgrows this file.
    - `docs/deploy-runbook.md`: Render, DNS, Google OAuth client, Resend inbound domain, Bookeeping.ai key, first import.
    - `docs/api-guide.md`: short intro (errors, pagination) rendered at the top of the `/_scalar` reference.
    - Runbooks, decision notes, design docs, delivery plans: one file each, semantic kebab-case names (`docs/deploy-runbook.md`, not `docs/notes2.md`).
- Update docs in the same change as the code they describe.
