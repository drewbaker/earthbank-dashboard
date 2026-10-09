# Earth Bank Dashboard

Earth Bank leadership's internal dashboard for tracking fundraising. It shows cash, burn and runway, the grant pipeline grouped by funding goal (Design Grants, OpEx, Lending Capital), and the milestones and tasks that get money in the door. AI reads funder email to keep the pipeline current. It runs at `https://dashboard.theearthbank.org`, and only `@theearthbank.org` Google accounts can sign in.

The product spec and house conventions are in [AGENTS.md](AGENTS.md); the delivery plan and status are in [docs/build-plan.md](docs/build-plan.md).

## Features

- **Overview**: cash on hand, monthly burn, runway (committed money vs weighted pipeline), goal progress, my tasks, upcoming milestones, recent changes
- **Pipeline**: funders, contacts and opportunities by goal (Design Grants, OpEx, Lending Capital) and stage; table, funder list and drag-and-drop board; full change history with revert
- **Milestones & Tasks**: milestones with tasks, assignees and deadlines; drag to reorder; "by person" view; comments and file attachments; email alerts on assignment and comments, plus a weekday digest
- **Forecast**: 24-month cash projection with a live scenario builder (slip a funding date, change an amount or probability, add a hire or one-off cost, change burn); saved scenarios
- **Email intelligence**: connect Gmail and the AI keeps funder stages, amounts, dates and next steps current from funder email only, with the email summary and reasoning behind every change; forward any email to a private address; review, accept or revert on the Activity page
- **Email drafts**: funders waiting on a reply are flagged; **Draft email** has the AI write a reply in the thread's tone, using the pipeline and Earth Bank's Drive documents, and saves it to your Gmail drafts (never sends)
- **Knowledge**: connect Earth Bank's Google Drive folder (business models, explainers) so drafts use the team's own facts; pin or exclude documents
- **Bank data** from Bookeeping.ai (or entered by hand)
- **Spreadsheet import** of the Master Pipeline tab, in Settings → Import or `npm run import:pipeline`
- Google sign-in, limited to the Earth Bank Workspace; accounts are created on first sign-in

## Stack

Nuxt 4 (Nitro, `node-server`) · Nuxt UI · TypeScript · SQLite (WAL) + Prisma · Sidequest jobs · Nitro scheduled tasks · Resend · Anthropic · Bookeeping.ai · Render with a persistent disk.

## Local setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Then open `http://localhost:3000`.

- **Google sign-in** needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. The OAuth client must list `http://localhost:3000/auth/google/callback` as a redirect URI (see [docs/deploy-runbook.md](docs/deploy-runbook.md)).
- **Encryption**: set `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`). Development falls back to a fixed key when it's empty.
- **Email** prints to the console until `RESEND_API_KEY` is set.

| URL | What |
|---|---|
| `http://localhost:3000` | Dashboard |
| `http://localhost:3000/_scalar` | API reference (signed in) |
| `http://localhost:3000/admin/jobs` | Sidequest jobs dashboard (signed in) |
| `http://localhost:3000/healthz` | Health check |

## Project layout

```
app/           Nuxt frontend (pages, layouts, components, composables)
server/        Nitro: routes (/v1 API, auth, webhooks), middleware, plugins, tasks,
               database/ (all Prisma queries) and utils/ (framework-agnostic helpers)
shared/        zod schemas and constants used by both app and server
jobs/          Sidequest job classes, exported from sidequest.jobs.ts
prisma/        schema.prisma and migrations
scripts/       tsx CLIs (pipeline import, evals)
tests/         Vitest unit and integration tests
docs/          build plan, deploy runbook, API guide
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server on port 3000, with job workers |
| `npm run build` | Production build into `.output` (including the jobs bundle) |
| `npm run typecheck` | `vue-tsc` across app, server and shared code |
| `npm test` | Vitest |
| `npm run db:migrate` | Create and apply a migration after editing `schema.prisma` |
| `npm run format` | Prettier |
| `npm run import:pipeline -- file.xlsx [--dry-run]` | Import the Master Pipeline tab (safe to re-run) |
| `npm run eval:classify-email` | Score the email classifier against labelled fixtures (calls the Anthropic API) |

## Version pins

- **TypeScript 6.0.3**: TypeScript 7 no longer ships the JavaScript compiler API that `vue-tsc` uses.
- **Prisma 7.10.0**: the CLI, `@prisma/client` and `@prisma/adapter-better-sqlite3` must match exactly. npm's `latest` tag for `prisma` points at an 8.0 release candidate, so pin explicitly.
- **better-sqlite3 12.x**: the Prisma adapter and Sidequest's SQLite backend both require `^12`.
- **h3 1.x**: the version Nitro 2 uses. `h3@2` is a different API.
- **nuxt-charts 3.1.0**: a stable release the maintainers still publish under the `next` tag (npm `latest` is 2.2.3). 3.x is needed for `referenceLines` (the runway chart's $0 "out of cash" threshold); its docs site runs on it.

## Deploying

Render, from `render.yaml`. See [docs/deploy-runbook.md](docs/deploy-runbook.md).
