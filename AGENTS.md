# Agent instructions

This file is for coding agents (Claude Code, Codex, Cursor, Gemini, Copilot and others). Read it fully before
changing anything. Then read whichever of these the task touches:

- [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md): step-by-step recipes (new source, new metric, new tile or component,
  new view, theme, settings). Start here for almost any feature request.
- [DESIGN_GUIDELINES.md](DESIGN_GUIDELINES.md): visual and copy rules for anything a user sees.
- [docs/API.md](docs/API.md): HTTP endpoints and the `/api/metrics` response shape. Keep it in sync with the code.
- [DEPLOYMENT.md](DEPLOYMENT.md): hosting, provider setup and recovery.

The owner of a fork is expected to customise this dashboard by prompting you. Treat a request like "add a
Mastodon tile" or "make the theme green" as a normal feature: find the matching recipe, follow it, add tests and
run `npm run verify`.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Install. Node 22.18 or later. |
| `npm run verify` | **Run before you hand off any change.** TypeScript (Worker and web), all tests, UI build, Worker dry-run bundle. |
| `npm test` | Tests only (`node:test` through `tsx`, files in `tests/`). |
| `npm run dev` | Builds the UI, applies local migrations, runs the Worker on http://localhost:8787 with `--test-scheduled`. |
| `npm run web:dev` | Vite with hot reload on :5173; proxies `/api` and `/fonts` to `npm run dev`. Run both for UI work. |
| `npm run selfhost` | Production-style local run with persistent `./data` and the built-in cron scheduler. |
| `npm run setup:cloudflare` / `npm run deploy` | Cloudflare deployment. Do not run these unless the owner asks in the current task. |

Trigger a scheduled run locally: `curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"` (the minute of the
current time decides which job group runs; see `slotFor` in `src/worker.ts`).

## Architecture

```
web/  React 19 + Tailwind 4 + shadcn/ui + Recharts. Built by Vite into public/app (git-ignored).
  src/App.tsx            shell: sidebar, header, tabs, theme toggle, polling
  src/views/             overview.tsx (tiles + chart + ledger), content.tsx (posts), other.tsx (connections, import)
  src/components/        app components; ui/ holds shadcn primitives (add more with `npx shadcn add <name>`)
  src/lib/metrics.ts     ALL analytics rules for the UI: labels, tiles, period changes, series. Pure functions, tested.
  src/lib/api.ts         fetch wrapper (same-origin JSON, Origin header handled by the browser)
  src/index.css          theme tokens (dark default, .light class), Tailwind theme mapping, motion utilities
src/  Cloudflare Worker (also runs under workerd for self-hosting)
  worker.ts              HTTP routing, /api/* endpoints, cached report builder, cron job scheduling (slots)
  data.ts                metric row validation and transactional upsert. The `sources` list lives here.
  oauth.ts               OAuth begin/callback/refresh for youtube, tiktok, instagram, facebook; AES-GCM token storage
  website.ts             Cloudflare Web Analytics and PostHog
  connectors.ts          YouTube Analytics and video totals
  social.ts, content.ts  TikTok/Instagram/Facebook OAuth account snapshots and content snapshots
  instagram.ts, facebook-page.ts   Meta system-user token connectors (richer insights)
  apple-analytics.ts, apple.ts, charts.ts   App Store Connect reports, Sales and Trends, chart rank
  github.ts, github-repos.ts       GitHub GraphQL activity
  content-history.ts     per-content view history and cross-platform grouping
  limits.ts, safe-error.ts         sync locks, stale-run cleanup, safe error messages
migrations/  D1 (SQLite) schema. Append-only.
scripts/     setup-cloudflare.mjs, selfhost.mjs, env.mjs (shared helpers). Plain Node, no dependencies.
tests/       node:test suites, one per module area.
```

Data flow: a connector fetches from a provider → validates → `save()` upserts rows into `metrics`
(`source, date, metric, value, unit, timezone, provenance`) or `content_snapshots` → `GET /api/metrics` returns
everything the UI needs in one cached response (2 minutes, cleared on any POST) → `web/src/lib/metrics.ts` turns
rows into tiles and series.

Settings are environment variables (Worker secrets on Cloudflare, `.dev.vars`/`.env` locally). The full list with
comments is [.env.example](.env.example). **When you add a setting, add it there too**: the setup and self-host
scripts read their allowlist from that file.

## Rules

### Workflow
- Inspect the current branch, uncommitted changes and the relevant source before editing. Preserve other work.
- Work on a branch and open a pull request unless the owner says otherwise. Do not deploy, rotate secrets, change
  provider permissions or publish anything unless the owner asked for it in the current task.
- Add focused tests for data, connector and API behaviour. A passing suite does not prove a live provider works;
  say which parts you verified against real APIs and which you did not.
- Update docs/API.md when you change an endpoint or the report shape, and .env.example when you add a setting.

### Security
- **There is no built-in authentication.** The owner protects the deployment with Cloudflare Access, a private
  network or an authenticating proxy. Do not add a login system unless the owner asks for one. Do not weaken what
  is there either:
  - keep the POST checks (same `Origin`, `Content-Type: application/json`), the CSP and the security headers;
  - keep OAuth state one-use, ten-minute, bound to the provider and to the `oauth_binding` browser cookie
    (stored in the `oauth_states.identity` column, a name kept from the original schema);
  - keep tokens encrypted with AES-GCM and the provider as additional data; never return them from the API.
- Never commit secrets, `.dev.vars`, `.env`, `wrangler.production.json`, database exports or `./data`.
- Never replace `TOKEN_ENCRYPTION_KEY` on an existing deployment: stored tokens depend on it.
- Never store raw provider error bodies; use `SafeError`/`safeMessage` for messages shown in sync history.

### Analytics correctness
- Unavailable data is not zero. Failed syncs keep existing rows and record a short, safe status message.
- Account and content snapshots (metric names ending `_snapshot`, lifetime views) are observed totals, not daily
  gains. Never sum them across dates. Growth needs comparable observations on different dates.
- Keep provider reporting dates, units, time zones and provenance. Do not combine incompatible metrics or claim a
  cross-platform unique audience. Never add Cloudflare and PostHog page views together.
- Check current provider documentation before changing scopes, endpoints or fields. Reject partial reports and
  unexpected schemas rather than guessing.
- TikTok's token endpoint needs exactly `Content-Type: application/x-www-form-urlencoded` (a charset suffix fails).
  Keep the explicit header and its regression test.

### Platform limits
- Cloudflare Workers Free allows 50 subrequests per invocation and 5 cron triggers per account. That is why one
  quarter-hourly cron rotates through four job groups (`SLOTS` in `src/worker.ts`). Keep new hourly jobs inside a
  slot's budget, or add them to the least busy slot. Manual syncs run in `waitUntil` and must finish in ~30 seconds.
- `/api/metrics` loads at most 20,000 audience values, 5,000 GitHub values and 500 latest content items, and says
  so when truncated. Raise limits deliberately and test the query cost.

### Schema
- Add schema changes as a new numbered file in `migrations/`. Never edit an applied migration.
- Both runtimes apply migrations: `npm run dev`/`selfhost` locally, `setup:cloudflare`/`deploy` on Cloudflare.

### UI and copy
Follow [DESIGN_GUIDELINES.md](DESIGN_GUIDELINES.md). In short: calm, no eyebrow labels, say each fact once,
components read theme tokens instead of literal colours, motion only signals status and stops under
`prefers-reduced-motion`, and every view works at phone width and in both themes.
