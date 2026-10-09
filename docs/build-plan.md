# Earth Bank Dashboard: build plan

The phased plan for building the dashboard described in [`AGENTS.md`](../AGENTS.md) §0. Work through the phases in order. Each phase ends with `npm run typecheck`, `npm test` and the app running at `http://localhost:3000`. Tick items off as they land; this checklist is the implementation status.

Conventions come from AGENTS.md: aliases with `.ts` extensions, no auto-imports, one object argument per function, full JSDoc, Prettier with 4 spaces, queries only in `server/database/`, and serializers for every response.

---

## Phase 1: Foundation

Goal: a deployable, Google-sign-in-only shell with the dashboard layout and theme.

Status: built and verified locally (typecheck, 18 tests, dev server, production build). Not yet deployed.

Notes from building it:

- Pinned TypeScript 6.0.3 (TypeScript 7 has no JS compiler API for `vue-tsc`), Prisma 7.10.0 (npm `latest` is an 8.0 RC), better-sqlite3 12.x, h3 1.x. See README → Version pins.
- Signed-out access to `/_scalar`, `/_openapi.json` and `/admin/jobs` redirects to `/login` (or 401 for the JSON).
- The OpenAPI document is trimmed to `/v1` routes in `server/plugins/20.openapi.ts`.

- [x] Scaffold Nuxt on Node 24 LTS with current stable versions. Check them with `npm view <pkg> version` at the time; don't copy versions from this doc.
    - [x] `package.json` with `imports`, scripts and engines (AGENTS.md §12); `.prettierrc`; `.gitignore`; `.env.example`; `tsconfig.json`
    - [x] `nuxt.config.ts`: `@nuxt/ui`, `nuxt-charts`, Public Sans, auto-imports off, `routeRules`, `nitro` (`node-server`, tasks, openAPI, `externals.trace: false`, jobs bundle hook)
    - [x] `vitest.config.ts`; `.claude/launch.json` (`dev`, port 3000)
- [x] Theme from the loans app: `app/app.config.ts` (green / blue / zinc, `defaultVariants`) and `app/assets/css/main.css` (light/dark tokens, radius 0.25rem, pointer cursor rule)
- [x] Prisma: `prisma.config.ts`, `schema.prisma` header comment, `User` (`google_sub` unique, email, name, avatar_url, role default `admin`, last_sign_in_at, deactivated_at), `Session`, `AuditLog`
- [x] Server core: `server/utils/config.ts`, `db.ts`, `ids.ts` (`ID_PREFIXES` for every kind in AGENTS.md §0), `errors.ts`, `api.ts` (`defineApiHandler`, `parseBody`, `parseQuery`, `requestIp`), `audit.ts`, `crypto.ts` (AES-256-GCM `encryptSecret` / `decryptSecret`)
- [x] Middleware: `00.canonical-host.ts`, `01.security-headers.ts`, request size limit, `10.auth.ts`
- [x] Google sign-in (`server/utils/auth/google.ts` on `google-auth-library`):
    - [x] `GET /auth/google`: state + PKCE + same-site redirect in a short-lived signed cookie; scopes `openid email profile`; `hd=theearthbank.org`
    - [x] `GET /auth/google/callback`: verify state and ID token; require `email_verified`, `hd === GOOGLE_WORKSPACE_DOMAIN`, email suffix `@theearthbank.org`; upsert by `google_sub`; reject `deactivated_at`; create session; redirect
    - [x] Wrong account → `/login?error=wrong_account`
    - [x] `POST /v1/auth/logout`, `GET /v1/auth/me`
- [x] Sessions: hashed opaque token, `SESSION_TTL_DAYS` (7), cookie `earthbank_dashboard_session`; CSRF Origin check
- [x] App shell:
    - [x] `layouts/default.vue` (`UDashboardGroup` + sidebar from `app/utils/navigation.ts`: Overview, Pipeline, Forecast, Milestones & Tasks, Activity, Settings); `layouts/auth.vue`
    - [x] `pages/login.vue` (single Google button, error state)
    - [x] `middleware/auth.global.ts`, `composables/useApi.ts`, `composables/useAuth.ts`
    - [x] Placeholder pages for each nav item
- [x] Settings → Team: list users (name, email, last sign-in) and **Deactivate** (`POST /v1/users/{id}/deactivate`, deletes sessions)
- [x] `/healthz`; OpenAPI plugin + Scalar at `/_scalar`; catch-all `/v1/[...path].ts` JSON 404
- [x] Email adapter (`server/utils/email/`: Resend + console fallback) and `SendEmailJob`; Sidequest wiring (`sidequest.jobs.ts`, plugin, `/admin/jobs` proxy)
- [x] Nitro tasks `cleanup` and `backup`
- [x] `render.yaml` (AGENTS.md §3), `README.md`, `docs/deploy-runbook.md` (first draft)
- [ ] First deploy to Render with a real Google OAuth client (needs the client id and secret)
- [x] Tests:
    - [x] `google-sign-in.test.ts`: other domains, missing `hd`, unverified email and deactivated users are rejected; a valid user is created, then updated on the next sign-in (mock `verifyIdToken`)
    - [x] `openapi-coverage.test.ts`
    - [x] `ids.test.ts`
    - [x] Test helper that creates a user and session directly

## Phase 2: Pipeline core + import

Goal: the spreadsheet's Master Pipeline lives in the app and can be edited, and every change is logged.

Status: built and verified locally. The real sheet imports as 70 funders, 58 contacts and 29 opportunities; a second run changes nothing.

Notes from building it:

- Money columns are `BigInt` (Prisma's `Int` is 32-bit, too small for $50M lending asks); serializers return plain numbers.
- Calendar dates (expected receipt, last contact, target date) travel as `YYYY-MM-DD` and are stored at UTC midnight.
- Contacts are soft-deleted; re-adding the same email to the same funder restores the contact.
- The importer also creates bare prospects for the names listed under "PIPELINE TOTAL", and an amount-less design-grant opportunity for "Design Grant Only" funders in conversation.
- Re-imports never overwrite a field someone edited by hand (any applied manual change event for that field).

- [x] Prisma models:
    - [x] `Funder`: name (unique, case-insensitive via a `name_key` column), kind (`foundation | dfi | corporate | individual | government | other`), tier (`t1`–`t4`), relationship_status (`no_contact | early | active | advanced | committed | dead`), geo_focus, email_domains (JSON array), materials_sent_at, last_contact_at, notes, owner_id, status `draft | active` (drafts come from forwarded emails), archived_at
    - [x] `Contact`: funder_id, name, title, email (unique when present), notes
    - [x] `Goal`: type (`design_grant | opex | lending_capital`), name, target_amount_cents, target_date, notes. Seed the three goals in a migration-safe seed function that runs at boot when the table is empty.
    - [x] `Opportunity`: funder_id, goal_id, name, stage (`identified | in_discussion | proposal | due_diligence | committed | received | lost`), amount_cents, probability_override, expected_decision_at, expected_receipt_at, received_at, next_step, owner_id, archived_at
    - [x] `ChangeEvent`: entity_type, entity_id, field, from_value, to_value (JSON), source (`manual | import | ai_email | ai_forward`), status (`applied | pending | rejected | reverted`), actor_user_id, evidence_id, reason, confidence, created_at
    - [x] `Setting`: key, value JSON. `stage_probabilities` defaults: identified 5, in_discussion 15, proposal 35, due_diligence 60, committed 95, received 100, lost 0.
- [x] `server/utils/change-events.ts`: `applyFieldChanges({ entityType, entityId, changes, source, actorUserId, evidenceId, reason, confidence })`, the only write path for tracked fields; `revertChange({ changeEventId })`
- [x] zod schemas in `shared/schemas/` (`funders.ts`, `contacts.ts`, `opportunities.ts`, `goals.ts`, `settings.ts`) and constants in `shared/constants/` (stages, tiers, goal types, labels, colors)
- [x] `/v1` routes:
    - [x] funders: list (filters: tier, relationship_status, goal, owner, `q`), get, create (enqueues the backfill job once Phase 5 lands), patch, archive
    - [x] funders/{id}/contacts: CRUD
    - [x] opportunities: list, get, create, patch, archive
    - [x] goals: list with computed totals (committed, weighted, received), patch
    - [x] change-events: list by entity
    - [x] settings/stage-probabilities: get, put
- [x] Pages:
    - [x] `/pipeline`: `UTable` of opportunities joined with funders. Columns: funder, goal, stage, amount, weighted amount, expected receipt, next step, owner, last contact. Filters and goal tabs; toggle to a kanban by stage (drag to change stage calls `applyFieldChanges`).
    - [x] `/pipeline/funders/[id]`: header (tier, status, owner, domains), contacts, opportunities, notes, timeline (change events; later emails and tasks)
    - [x] "New funder" modal: name, contact name and email, domains (pre-filled from the email unless it's a free-mail domain), goal, optional first opportunity
- [x] `scripts/import-pipeline.ts <path.xlsx>`, using `read-excel-file`, sheet "Master Pipeline", header row 4. Idempotent: match on normalized org name and re-run safely.
    - [x] Merge duplicate rows (e.g. Nordic Development Fund, Hewlett Foundation); keep the row with more data and the higher tier
    - [x] Contacts: split column B on `;` and `,` and pair with column C emails by position; ignore `—`, "Not found in inbox — verify manually" and parenthetical notes (keep them in the contact's notes)
    - [x] `email_domains` from contact emails, skipping free-mail domains
    - [x] Tier `T1`–`T4` → `t1`–`t4`; status → relationship_status (Committed, Advanced, Active, Early, No Contact, Dead)
    - [x] Last Contact: parse the leading date (`Jun 2, 2026 (met Jun 10)`, `Jun 2026 (…)`, `Apr 2026 (…)`); keep the full text in notes
    - [x] Design / Grant $ > 0 → `design_grant` opportunity; Potential Follow-On $ > 0 → `lending_capital` opportunity. Stage from status: Committed→committed, Advanced→due_diligence, Active→in_discussion, Early→identified, Dead→lost. No Contact creates no opportunity.
    - [x] Potential Size ("Design Grant Only", "Above $10M", "Sub $10M", "TBD") goes into notes
    - [x] EB 3-Pager `Y` → `materials_sent_at` = the import date (the sheet has no date)
    - [x] Notes: full text into `funder.notes`; text after `NEXT:` into each opportunity's `next_step`
    - [x] All writes use `applyFieldChanges` with source `import`
    - [x] Print a summary: created, updated, merged, skipped
- [x] Tests: `import-pipeline.test.ts` (against a small fixture xlsx built in the test; idempotent on re-run), `change-events.test.ts`, `funders-api.test.ts`

## Phase 3: Milestones, tasks, collaboration

Goal: it's obvious what each person has to do, for which milestone, by when.

Status: built and verified locally (milestones page by milestone and by person, task slideover with comments and files, funder-page tasks, emailed deep links via `?task=`).

Notes from building it:

- A task's funder is filled in from its opportunity (or its milestone's opportunity), so funder pages list every related task.
- Attachments always download (`Content-Disposition: attachment`, `nosniff`) so uploaded HTML/SVG can't run in our origin; removed files are purged by `cleanup` after 30 days.
- `POST /v1/tasks/reorder` exists; drag-to-reorder in the UI is not built yet (tasks sort by deadline, then order).
- The weekday `task-digest` runs at 13:00 UTC.

- [x] Prisma models:
    - [x] `Milestone`: title, description, due_at, goal_id?, opportunity_id?, status (`upcoming | done | missed`), kind (`funding | event | internal`)
    - [x] `Task`: title, description, assignee_id, due_at, status (`todo | doing | done`), milestone_id?, opportunity_id?, sort, completed_at, created_by
    - [x] `Comment`: task_id, author_id, body (Markdown), edited_at, deleted_at
    - [x] `Attachment`: task_id, uploaded_by, filename, content_type, size_bytes, storage_key
- [x] `server/utils/storage.ts` (local disk under `DATA_DIR/files`, key escape checks); upload limit 25 MB
- [x] `/v1` routes: milestones CRUD; tasks CRUD + reorder; tasks/{id}/comments CRUD; tasks/{id}/attachments upload, list, delete; `attachments/{id}/download`
- [x] Notifications (`server/utils/notifications.ts` → `enqueueEmail`):
    - [x] Task assigned (to someone other than yourself) → email the assignee with title, milestone, due date and link
    - [x] Comment → email the assignee and earlier commenters, excluding the author
    - [x] Email templates with `html` and `text`
- [x] Pages:
    - [x] `/milestones`: timeline grouped by milestone (date order) with progress (done / total) and tasks beneath
    - [x] "By person" tab: each user's open tasks sorted by due date ("Drew: A, B, C before Jan 1")
    - [x] Task slideover: edit fields, comments thread, attachments drop zone
    - [x] Funder and opportunity pages show linked milestones and tasks, with "Add task" inline
    - [x] Overview "My tasks" card (overdue highlighted)
- [x] Optional `task-digest` Nitro task (weekday mornings)
- [x] Tests: `task-notifications.test.ts` (recipients fan-out, no self-notify), `attachments.test.ts` (storage key safety)

## Phase 4: Cash, burn, forecast, scenarios

Goal: one view of cash runway against the pipeline, plus what-if modeling.

Status: built and verified locally with a manual balance and burn (no Bookeeping.ai key yet); the sync is covered by an integration test against a fake API that mirrors Bookeeping.ai's OpenAPI spec.

Notes from building it:

- Bookeeping.ai transactions are double-entry: the "main" entry is the bank side (DEBIT = money in) and the other entry carries the category. Burn counts operating categories (EXPENSE, COST_OF_GOODS_SOLD, OTHER_EXPENSE, OVERHEAD, TAX, TAX_PAYABLE) plus uncategorized money out, net of refunds; transfers, loans, equity and income are left out.
- Cash on hand prefers the bank's own balance (`institutionBalance`, via Plaid) over the ledger balance. Month-end history comes from `monthWiseBalance`. Non-deposit accounts (cards, loans) start excluded.
- Without `BOOKEEPING_API_KEY`, Settings → Cash takes a manual balance and burn so the forecast works on day one.
- The forecast only counts Design Grants and OpEx money by default (lending capital goes into the lending structure); configurable in Settings → Cash. Overdue expected receipts are modeled as landing today; undated asks are listed, not drawn.
- The projection runs in the browser (`shared/forecast/project-runway.ts`), so scenario changes redraw instantly. Scenario adjustments also include `change_probability`.
- Chart colors were checked with the dataviz palette validator for light and dark surfaces; the scenario line is dashed so it isn't color-only.
- `nuxt-charts` stays on 2.2.3 (npm `latest`); 3.x is only published under the `next` tag.

- [x] Prisma models:
    - [x] `BankAccount`: external_id, name, institution, currency, is_included (counts toward cash), last_synced_at
    - [x] `BalanceSnapshot`: bank_account_id, as_of (date, unique per account), balance_cents
    - [x] `BankTransaction`: external_id (unique), bank_account_id, booked_on, amount_cents (negative = outflow), description, category, counterparty, is_excluded_from_burn
    - [x] `Scenario`: name, description, adjustments (JSON), created_by, is_pinned
- [x] `server/utils/bookkeeping/`: `BookkeepingProvider`, `BookeepingAiProvider` (Bearer key, paginate, back off on 429), `FixtureProvider`. Read `https://docs.bookeeping.ai/api-reference/openapi.json` first to confirm field names.
- [x] `SyncBookkeepingJob` + hourly `bookkeeping-sync` task: upsert accounts, today's balance snapshot, transactions since the last sync minus 7 days (catches late edits)
- [x] Burn (`server/utils/burn.ts`): trailing 3 full months of net outflow from included accounts, excluding transfers between own accounts, categories marked excluded in Settings, and inflows tagged as grants. Manual override in Settings (`burn_override_cents`).
- [x] `shared/forecast/project-runway.ts`, pure and unit-tested:
    - Inputs: `{ startingCashCents, monthlyBurnCents, opportunities: [{ id, amountCents, expectedReceiptAt, probability, stage }], milestones, adjustments, months: 24, today }`
    - Output: `{ months: [{ month, committedCashCents, weightedCashCents }], committedRunwayOutAt, weightedRunwayOutAt, markers }`
    - Committed line counts `committed` and `received` stages only; weighted line multiplies by stage probability (or the override)
- [x] `shared/schemas/scenarios.ts`: adjustment union: `shift_receipt { opportunity_id, months }`, `change_amount { opportunity_id, amount_cents }`, `exclude_opportunity { opportunity_id }`, `add_recurring_cost { label, monthly_cents, starts_at, ends_at? }`, `add_one_off { label, amount_cents, at }` (positive = income), `change_burn_pct { pct, starts_at }`
- [x] `/v1` routes: `cash/summary` (balance, burn, runway, last sync), `cash/accounts` (toggle included), `forecast` (base projection inputs), scenarios CRUD, `settings/burn`
- [x] Pages:
    - [x] `/` Overview: KPI tiles (cash, monthly burn, runway months + date, committed $ and weighted $ per goal), goal progress bars vs target, small runway chart, upcoming milestones (next 30 days), my tasks, recent AI updates
    - [x] `/forecast`: line chart (committed, weighted, and the selected scenario) with milestone markers and a zero line; scenario side panel with live client-side recalculation through `projectRunway`, drag-to-shift opportunity dates, "Add hire" / "Add one-off" forms, save, compare two scenarios
- [x] Tests: `runway-projection.test.ts` (every adjustment kind, runway-out date, probability weighting), `burn.test.ts`, `bookkeeping-sync.test.ts` (mocked fetch, idempotent)

## Phase 5: Email intelligence

Goal: the pipeline updates itself from funder email, with evidence and an easy override. See AGENTS.md §10 "Email intelligence" for the rules.

Status: built and verified locally with a fake AI (no Google OAuth client, Anthropic key or Resend inbound domain yet). Integration tests cover auto-apply vs review, manual-wins, no stored bodies, sensitive subjects, draft funders, replaced forwarding addresses and webhook signatures.

Changes from the original plan (and why):

- **Model**: `claude-opus-5-5` by default (`AI_MODEL` to change), via structured outputs (`beta.messages.parse` + zod) with server-side refusal fallbacks. Opus 5.5 rejects forced tool use, so the planned forced-tool + Haiku/Sonnet cascade was dropped; one model, low effort.
- **Gmail sync** uses Gmail search with `after:` (last sync − 1 day; 90 days on first connect) instead of `historyId`: history would list every new message in the inbox, whereas search only ever returns funder mail.
- **Dedupe** is by RFC Message-ID, so an email in two people's inboxes is read once. Forwarded copies use the Resend id.
- **Forwarding** accepts any sender (the use case is mail that landed in a personal inbox); the secret token proves it came from a team member. Only Resend's email id is queued; the job fetches the content.
- **Instructions** live in `server/utils/ai/instructions.ts` (bundles into Nitro and workers without file reads).
- Email bodies never touch the database or the job queue; jobs carry ids and re-fetch.

- [x] Prisma models:
    - [x] `MailboxConnection`: user_id (unique), google_email, refresh_token_encrypted, scopes, history_id, last_synced_at, status (`active | error | revoked`), last_error
    - [x] `EmailEvidence`: source (`gmail | forward`), external_message_id (unique), mailbox_user_id, from_address, to_addresses, sent_at, subject (null when sensitive), summary (≤ 300 chars), is_sensitive, funder_id?, opportunity_id?, model, processed_at
    - [x] `InboundAddress`: user_id, token_hash, created_at, revoked_at
- [x] Gmail connect: `GET /auth/google/gmail` (incremental scopes, offline, consent) and its callback branch; `DELETE /v1/mailbox` revokes at Google and deletes the row
- [x] `server/utils/mail/`: `GmailProvider`, `buildFunderMailQueries({ contacts, domains })` (batched under Gmail's query length limit), `normalizeEmail` (strip quoted replies, signatures and HTML; cap at about 8k characters), `matchFunder({ addresses })` (exact contact email first, then domain, never free-mail domains)
- [x] `server/utils/ai/`: `AiProvider`, `AnthropicProvider` (forced tool use, zod → JSON Schema, Haiku first then Sonnet when confidence < 0.6), instructions in `server/utils/ai/instructions/classify-email/*.md`
- [x] Jobs:
    - [x] `SyncMailboxJob` (incremental via `historyId`; full query fallback when the history has expired)
    - [x] `BackfillFunderJob` (`newer_than:12m` for one funder across all connected mailboxes)
    - [x] `ClassifyEmailJob` (classify → `EmailEvidence` → `applyFieldChanges` with auto-apply when confidence ≥ 0.8 and the change is not a move to `lost` or an amount decrease; otherwise pending)
    - [x] `mail-sync` Nitro task every 15 min
- [x] Rules:
    - [x] Manual edits win: skip AI changes to a field when the email's `sent_at` is older than the field's latest manual change
    - [x] Never store or log the email body
- [x] Forwarding:
    - [x] Settings → Email shows `updates+{token}@in.theearthbank.org` with copy and regenerate buttons
    - [x] `POST /webhooks/inbound-email`: verify the Resend signature; resolve the token; require the envelope sender to be that user's address; `parseInboundEmail` unwraps the forwarded original; enqueue `ClassifyEmailJob` with source `ai_forward`
    - [x] Unknown sender → the AI proposes a draft funder (status `draft`) with contact, domain, goal type and opportunity; confirming it on Activity activates it and enqueues `BackfillFunderJob`
- [x] `/activity` page: feed of change events (filters: source, status, funder, date). Each row shows what changed, the evidence summary, sent date and sender, the AI reason and confidence, and **Accept / Reject** (pending), **Revert** (applied), and **Edit** (opens the field). A "Needs review" count badge in the sidebar.
- [x] Funder timeline includes email evidence entries
- [x] `scripts/eval-classify-email.ts` + git-ignored `tests/fixtures/emails/*.eml` with expected outputs; prints accuracy per field
- [x] Tests: `email-matching.test.ts`, `classify-email.test.ts` (mocked AI: auto-apply vs pending, manual-wins rule, no body stored), `inbound-webhook.test.ts` (bad signature, bad token, wrong sender, unknown sender → draft)

## Phase 6: Hardening + deploy

- [ ] Review every `/v1` route for `requireUser`, zod validation, serializer use and audit entries
- [ ] Empty, loading and error states on every page; mobile-width check of Overview, Pipeline and task slideover
- [ ] Finish `docs/deploy-runbook.md`:
    1. Render: create from `render.yaml`, set the `sync: false` secrets, attach the disk
    2. DNS: CNAME `dashboard.theearthbank.org` → the Render service; add the custom domain in Render; enable edge caching
    3. Google Cloud (Earth Bank Workspace project): OAuth consent screen **Internal**; OAuth client (web) with redirect URIs `https://dashboard.theearthbank.org/auth/google/callback`, `…/auth/google/gmail/callback` and the localhost equivalents; enable the Gmail API
    4. Resend: verify `mail.theearthbank.org` for sending; set up inbound on `in.theearthbank.org` (MX records) with the webhook pointing at `/webhooks/inbound-email`; copy the signing secret
    5. Bookeeping.ai: Settings → API Access → create a key; set `BOOKEEPING_API_KEY`
    6. Anthropic: set `ANTHROPIC_API_KEY`
    7. Upload the spreadsheet to `/var/data/imports/` and run `npm run import:pipeline -- /var/data/imports/pipeline.xlsx` from the Render shell
    8. Drew, Leslie and Steve sign in with Google (this creates their accounts), then each connects Gmail in Settings → Email
- [ ] Deploy, smoke-test sign-in with a non-Earth-Bank Google account (must be refused), run a Bookeeping.ai sync, forward a test email

---

## Later (not v1)

- Import the Fund Manager Pipeline, Bank & Credit Partners and NYCW Invitees tabs (`funder.kind`, events with attendees)
- CSV export of the pipeline
- Viewer/editor roles
- Public API keys and an MCP server for asking Claude about the pipeline
