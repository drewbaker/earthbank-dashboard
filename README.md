# Earth Bank Dashboard

Earth Bank leadership's internal dashboard for tracking fundraising. It shows cash, burn and runway, the grant pipeline grouped by funding goal (Design Grants, OpEx, Lending Capital), and the milestones and tasks that get money in the door. AI reads funder email to keep the pipeline current. It runs at `https://dashboard.theearthbank.org`, and only `@theearthbank.org` Google accounts can sign in.

The product spec and house conventions are in [AGENTS.md](AGENTS.md); the delivery plan and status are in [docs/build-plan.md](docs/build-plan.md).

## Features

- Google sign-in, limited to the Earth Bank Workspace; accounts are created on first sign-in
- Team settings with deactivation
- Coming next: the pipeline, milestones and tasks, cash and forecast, and email intelligence (see the build plan)

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

## Version pins

- **TypeScript 6.0.3**: TypeScript 7 no longer ships the JavaScript compiler API that `vue-tsc` uses.
- **Prisma 7.10.0**: the CLI, `@prisma/client` and `@prisma/adapter-better-sqlite3` must match exactly. npm's `latest` tag for `prisma` points at an 8.0 release candidate, so pin explicitly.
- **better-sqlite3 12.x**: the Prisma adapter and Sidequest's SQLite backend both require `^12`.
- **h3 1.x**: the version Nitro 2 uses. `h3@2` is a different API.

## Deploying

Render, from `render.yaml`. See [docs/deploy-runbook.md](docs/deploy-runbook.md).
