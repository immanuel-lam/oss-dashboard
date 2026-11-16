# Customising the dashboard

Recipes for the changes people ask for most. Each one lists the files to touch in order. They are written for
coding agents and humans alike: an agent should follow the matching recipe, then run `npm run verify`.

Before you start, run `npm run dev` and `npm run web:dev` in two terminals and import
[sample-import.json](sample-import.json) from the Import tab so there is data on screen.

---

## 1. Change the name, links or theme

- **Name**: set `DASHBOARD_NAME` (sidebar and browser tab). No code change.
- **Profile links** on tiles and in Connections: `PROFILE_URLS=youtube=https://youtube.com/@you,github=https://github.com/you`.
- **Colours**: edit the tokens in `web/src/index.css`. `:root` is the dark theme, `.light` the light theme.
  `--primary` is the accent (selected tile, chart line, focus ring); `--chart-1`/`--chart-2` are the chart series.
  Components only read tokens, so you never need to touch a component to re-colour the app. If you need a new
  colour role, add a token to both themes and to the `@theme inline` block, then use it as a Tailwind class
  (`bg-<token>`, `text-<token>`).
- **Fonts**: put a `.woff2` file in `public/fonts/`, update the `@font-face` rules and `--font-sans`/`--font-display`
  in `index.css`, the preload links in `web/index.html`, and the font path regex in `src/worker.ts`
  (`/^\/fonts\/(manrope|hanken)\.woff2$/`). The CSP only allows same-origin fonts; do not load fonts from a CDN.
- **Logo**: the sidebar mark is the inline `<span>` next to the name in `web/src/App.tsx`. Replace it with an
  inline SVG component in `web/src/components/brand.tsx`.

## 2. Add a metric to an existing source

1. Collect it in the source's connector in `src/` and return rows with a `metric` name matching
   `^[a-z][a-z0-9_]{0,63}$`. Use the suffix `_snapshot` for observed totals (followers, lifetime counts); omit it for
   daily amounts (views that day). This one decision controls whether the UI sums or compares it.
2. Give it a readable label in `metricNames` in `web/src/lib/metrics.ts`. Change `primary` there if it should lead
   the tile.
3. Test the parser with a recorded provider response in `tests/`.

## 3. Add a new data source (for example Mastodon, Bluesky, Substack, Plausible, Stripe)

1. **Register the source** in both lists, keeping the same id:
   - `sources` in `src/data.ts` (server validation);
   - `Source`, `labels`, `primary` in `web/src/lib/metrics.ts` (UI). `labels` order is the tile order.
   - Add a brand icon path to `src/icons.ts` (Simple Icons, CC0) or let it fall back to the globe icon.
2. **Write the connector** as `src/<source>.ts`. Copy the shape of `src/website.ts` or `src/github.ts`:
   - an `Env` interface with its settings and a `<source>Ready(env)` check;
   - `sync<Source>(env)` that inserts a `sync_runs` row with status `running`, fetches with
     `AbortSignal.timeout(25000)`, validates through `validateImport`, calls `save(env.DB, rows)`, then sets the run
     to `success` or `error` with a short message (use `SafeError` for messages that may be shown);
   - fail the whole run on an unexpected response shape rather than saving partial data.
3. **Wire it into the Worker** (`src/worker.ts`):
   - extend `Env` with the connector's env interface;
   - add it to the `/api/sync/(...)` regex and the `jobs` map for the manual Sync button;
   - schedule it in one `slot` inside `scheduled()` (see the subrequest note in AGENTS.md);
   - add a readiness flag to `connectors` in `buildReport` so the UI knows it is configured.
4. **Settings**: add the variables, with a comment, to `.env.example`.
5. **UI**: in `web/src/views/other.tsx` add the `configured`, `about` and `syncable` cases for the new source;
   extend the `connectors` type in `web/src/lib/metrics.ts`.
6. **OAuth sources** instead extend `Provider`, `providers` and the URL/scope switches in `src/oauth.ts`, and the
   `/oauth/(...)/callback` and `/api/(connect|disconnect)/(...)` regexes in `src/worker.ts`. Document the callback URL
   in DEPLOYMENT.md.
7. **Tests**: a parser test with a recorded response, a "missing data stays missing" test, and a scheduling test if
   you changed `slotFor`/`SLOTS`.
8. **Docs**: add a row to the table in README.md and a setup section to DEPLOYMENT.md.

No connector yet, or a one-off? Sources can also be filled by `POST /api/import` from any script or automation
(see docs/API.md), so a cron job elsewhere can push numbers in without touching the Worker.

## 4. Add a tile, card or other component

- Tiles are computed in `tiles()` in `web/src/lib/metrics.ts` and rendered by `KpiCard` in
  `web/src/views/overview.tsx`. To change what a tile shows, change the pure function first and test it in
  `tests/metrics.test.ts`; keep the component a thin renderer.
- For a new standalone component, create `web/src/components/<name>.tsx`. Build from the shadcn primitives in
  `web/src/components/ui/` (add more with `npx shadcn@latest add <component>`; `components.json` is configured), use
  `lucide-react` icons, `cn()` from `@/lib/utils`, tokens for colour and `motion/react` only for status changes.
- Charts use Recharts through `web/src/components/ui/chart.tsx`; see `trend-chart.tsx` for the house style (one
  accent series, muted comparison line, no second y-axis, gaps for missing days).
- Read data from the `Report` passed down from `App.tsx`. If the data is not in `/api/metrics` yet, add it to
  `buildReport` in `src/worker.ts` (one batched D1 query, bounded with `LIMIT`) and to the `Report` type.

## 5. Add a view (tab)

1. Create `web/src/views/<name>.tsx` exporting a component that takes `{report, reload}`.
2. Register it in `web/src/App.tsx`: add an entry to `tabs` (id, label, lucide icon; the `Tab` type derives from
   it), a heading in `titles`, and a line in the render switch inside `<motion.section>`. The phone tab bar reads the
   same `tabs` list; keep the count at five or fewer.

## 6. Add an API endpoint

Add the route in `src/worker.ts` inside the `/api/` block. Writes must be `POST` (the shared Origin and
Content-Type check runs before the routes) and must clear the report cache, which happens automatically for any
POST to `/api/*`. Bound request sizes, validate input with explicit errors, return JSON through `respond()`, and
document it in docs/API.md with a test in `tests/worker.test.ts`.

## 7. Change the database

Add `migrations/000N_<name>.sql`. Never edit an existing migration. Local runs apply it automatically; on
Cloudflare `npm run deploy` applies it after deploying, so keep the code backward compatible for the moment
between the two (add columns as nullable, read new tables defensively).

## 8. Add sign-in

The project has none by design (see README). If the owner asks for one, prefer putting Cloudflare Access in front
and verifying its JWT in the Worker (`Cf-Access-Jwt-Assertion` header, `jose` is already a dependency), because
that keeps passwords out of this codebase. Bind OAuth state to the signed-in identity instead of the cookie.
