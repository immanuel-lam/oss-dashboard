# Deployment and provider setup

The README covers the short version. This file has the details: hosting options, every provider's setup, backups
and recovery.

## Hosting options

| | Cloudflare | Docker / self-hosted |
| --- | --- | --- |
| Command | `npm run setup:cloudflare`, then `npm run deploy` | `docker compose up -d` or `npm run selfhost` |
| Runtime | Workers | `workerd` (open-source Workers runtime) through `wrangler dev` |
| Database | D1 | Local D1 (SQLite files in `./data`) |
| Schedules | Cron triggers in `wrangler.jsonc` | Built-in scheduler in `scripts/selfhost.mjs`, same expressions |
| Settings | Worker secrets | `.env` (Docker) or `.dev.vars` |
| HTTPS for OAuth | Automatic | Your proxy or Cloudflare Tunnel |
| Protection | Cloudflare Access | Private network, proxy auth, or Access through a Tunnel |

Both run the same code. Nothing in `src/` knows which one it is on.

### Cloudflare details

`npm run setup:cloudflare` steps, all idempotent:

1. Checks `wrangler whoami`.
2. Finds or creates the D1 database `oss-dashboard`.
3. Writes `wrangler.production.json` (git-ignored) from `wrangler.jsonc` with the database ID, and with either
   `workers_dev: true` or your `--domain` as a custom domain (`workers_dev` and preview URLs then off).
4. Builds the UI, applies migrations, deploys.
5. Generates `TOKEN_ENCRYPTION_KEY` if the Worker does not have one. With `--secrets <file>` it uploads the non-empty
   settings from that dotenv file through `wrangler secret bulk`. It never overwrites an existing encryption key.

Change one setting later with `npx wrangler secret put NAME --config wrangler.production.json`.

### Self-hosted details

`scripts/selfhost.mjs` merges settings from the environment and `.dev.vars` (the file wins), writes them to
`$DATA_DIR/.dev.vars` for `workerd`, generates `$DATA_DIR/token-encryption-key` on first start if needed, applies
migrations, starts the Worker and fires the cron expressions from `wrangler.local.json` every matching minute
(UTC) through the local `/__scheduled` endpoint.

Environment: `HOST` (default `127.0.0.1`, Docker uses `0.0.0.0` inside the container), `PORT` (8787),
`DATA_DIR` (`./data`, Docker uses `/data`).

`/__scheduled` is reachable on the same port, so anyone who can reach the dashboard can start a sync. The
protection you put in front of the dashboard covers it as well.

Behind any proxy or tunnel that ends HTTPS, set `PUBLIC_URL=https://<your host>`. The Worker then sees plain
`http://` requests, and without this setting OAuth redirect URIs would use `http://`.

To give a self-hosted box HTTPS and Access without opening ports, run a Cloudflare Tunnel
(`cloudflared tunnel --url http://localhost:8787`, or a named tunnel with a hostname) and add an Access application
for that hostname.

## Protecting the dashboard

The app has no sign-in (the original private version used Cloudflare Access, and the Worker verified its JWT).
Choose one:

- **Cloudflare Access.** Zero Trust → Access → Applications → Add an application → Self-hosted. Application
  domain: the dashboard host, path empty (all paths, including `/api` and `/oauth`). Add a policy: Action *Allow*,
  Include *Emails* with your address. Login methods: *One-time PIN* needs no setup; Google or GitHub need an
  identity provider. For a `workers.dev` URL, use the *Enable Cloudflare Access* toggle in the Worker's Domains &
  Routes settings instead.
  For an app or script, create a service token (Access → Service credentials) and add a *Service Auth* policy.
- **Tailscale or WireGuard.** Keep port 8787 bound to localhost or the tailnet interface.
- **Reverse proxy.** For example, Caddy:
  ```
  dash.example.com {
    basic_auth { you <bcrypt hash from `caddy hash-password`> }
    reverse_proxy 127.0.0.1:8787
  }
  ```

## Providers

All settings are listed in `.env.example`. A source with missing settings stays "Not connected" and is skipped by
the schedule. Callback URLs below use `https://<host>`: your workers.dev or custom domain.

### Website: Cloudflare Web Analytics (preferred)

- `CLOUDFLARE_ANALYTICS_TOKEN`: API token with *Account Analytics: Read* for the account.
- `CLOUDFLARE_ANALYTICS_ACCOUNT`: the 32-character account ID.
- `CLOUDFLARE_ANALYTICS_SITE`: the Web Analytics site tag (32 hex characters, from the site's snippet).
- `SITE_HOSTNAMES` (optional): limit to your hosts, for example `example.com,www.example.com`.

Reads 7-day chunks, because larger windows are heavily sampled. Hourly runs read the last 14 complete UTC days.
The 00:00 UTC run and manual syncs read 180 days. Stores `page_views` and `visits`.

### Website: PostHog (fallback)

`POSTHOG_API_KEY` (a personal API key with *Query Read* on the project), `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`
(`https://us.posthog.com` or `https://eu.posthog.com`), and optionally `SITE_HOSTNAMES`. PostHog is used only
when Cloudflare is not configured. The two are never added together.

### YouTube (OAuth)

Google Cloud console → create OAuth client (Web application). Redirect URI `https://<host>/oauth/youtube/callback`.
Enable *YouTube Data API v3* and *YouTube Analytics API*. Add the scopes `yt-analytics.readonly` and
`youtube.readonly` to the consent screen. Set the app to *In production*; apps in testing status get short-lived
grants. Settings: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`. When you connect, choose the channel you own.
Daily analytics lag by 2–3 days.

### TikTok (OAuth, Display API)

TikTok for Developers → app with Login Kit and the scopes `user.info.basic`, `user.info.stats` and `video.list`.
Redirect URI `https://<host>/oauth/tiktok/callback`. Settings: `TIKTOK_CLIENT_ID` (the *client key*) and
`TIKTOK_CLIENT_SECRET`. App review asks for public Terms of Service and Privacy Policy URLs. Host your own pages for
these; the repository does not include any. Sandbox mode works for your own account before review.
Display API gives account totals and per-video lifetime views, likes, comments and shares. It does not give
Studio analytics such as watch time.

### Instagram

Preferred: a Meta system-user token. Set `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` (the numeric
professional account ID). This gives followers, daily views, reach, profile visits, interactions and post views.
Alternative: an OAuth app (Instagram API with Instagram Login) with `instagram_business_basic` and
`instagram_business_manage_insights`, redirect `https://<host>/oauth/instagram/callback`, and the settings
`INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET`. A professional (business or creator) account is required.

### Facebook Page

Preferred: `FACEBOOK_ACCESS_TOKEN` (a system-user token with `pages_show_list`, `pages_read_engagement` and
`read_insights` on the Page) and `FACEBOOK_PAGE_ID`. Alternative: an OAuth app with the same permissions, redirect
`https://<host>/oauth/facebook/callback`, and the settings `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` and
`FACEBOOK_PAGE_ID`. OAuth Facebook tokens do not refresh. Reconnect when the token expires.

### App Store

App Store Connect → Users and Access → Integrations → App Store Connect API → a key with the *Sales* or *Admin*
role. Settings: `APPLE_PRIVATE_KEY` (the full `.p8` PEM, newlines kept), `APPLE_KEY_ID`, `APPLE_ISSUER_ID` and
`APPLE_APP_ID` (the numeric Apple ID of the app). The dashboard needs an *ongoing* Analytics Report Request. The
first reports can take 24–48 hours.
Optional: `APPLE_VENDOR_NUMBER` turns on Sales and Trends history (`sales_*` metrics, up to a year).
Chart rank: `APP_STORE_COUNTRY` (default `us`). `APP_STORE_GENRES` adds genre charts as `slug:genreId` pairs, for
example `navigation:6010,travel:6003`. The slug must match Apple's chart URL.

### GitHub

`GITHUB_TOKEN`: a fine-grained personal access token. Select only the repositories you want to count. Give it
*Contents: Read-only* and *Pull requests: Read-only*, and nothing else. `GITHUB_REPOS`: `owner/name` pairs separated
by commas. One token must be able to read every listed repository. Hourly runs refresh 14 days. The 05:30 UTC run
re-reads 90 days.

### Google Play and everything else

There is no connector yet. Import JSON from the Import tab or with `POST /api/import` (see docs/API.md). For
example, a scheduled script can export Play Console statistics and push them in. To add a real connector, follow
docs/CUSTOMIZING.md §3.

## Schedule

Two cron triggers (within the Workers Free limit of 5 per account):

- `*/15 * * * *` rotates by minute: `:00` App Store chart rank, website and TikTok; `:15` Instagram; `:30` GitHub,
  Facebook and YouTube video totals; `:45` App Store Sales history.
- `30 5 * * *` runs App Store Analytics Reports and YouTube Analytics daily.

Manual Sync buttons run one source in the background. The browser re-reads stored reports every two minutes while
the page is visible.

## Backups and recovery

- **Cloudflare**: `npx wrangler d1 export oss-dashboard --remote --config wrangler.production.json --output backup.sql`.
  Roll back code with `npx wrangler deployments list` and `npx wrangler rollback <id>` (both with
  `--config wrangler.production.json`). A rollback does not undo D1 schema changes. Keep migrations backward compatible.
- **Self-hosted**: stop the container and copy `./data`. The directory holds the database and the encryption key.
- Keep `TOKEN_ENCRYPTION_KEY` safe. If you lose it, connected OAuth accounts must reconnect. Collected metrics are
  not affected.
- Disconnect deletes local tokens only. Revoke the app in the provider's settings to remove the grant.

## Limits

One response loads up to 20,000 audience values, 5,000 GitHub values and 500 latest content items. The UI warns
when it reaches these limits. Apple processes the latest report instances on each run. Imports replace rows that
have the same source, date and metric. There is no cross-platform unique-audience total.
