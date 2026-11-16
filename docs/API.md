# HTTP API

Everything the web UI does goes through these endpoints, so a native app (Android, iOS, a home-screen widget) or a
script can do the same. All responses are JSON with `Cache-Control: no-store`.

There is no authentication in the app itself. If the deployment sits behind Cloudflare Access, a non-browser client
needs an Access service token: send `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on every request, and
add a *Service Auth* policy for that token to the Access application.

## Reading

### `GET /api/metrics`

The whole dashboard in one response. Cached for two minutes per location and cleared by any `POST /api/*`.

```jsonc
{
  "settings": { "name": "Dashboard", "profiles": { "youtube": "https://…" } },
  "metrics": [                       // newest first; at most 20,000 audience + 5,000 GitHub rows
    { "source": "website", "date": "2026-11-10", "metric": "page_views", "value": 42,
      "unit": "count", "timezone": "UTC", "provenance": "Cloudflare Web Analytics: …", "updated_at": "…" }
  ],
  "truncated": false,                // true when the row limits above cut history
  "content": [                       // latest snapshot per post, at most 500
    { "source": "tiktok", "content_id": "…", "observed_date": "2026-11-16", "title": "…", "url": "https://…",
      "published_at": "…", "views": 1234, "likes": 56, "comments": 7, "shares": null }
  ],
  "contentHistory": [ { "source": "tiktok", "content_id": "…", "observed_date": "…", "views": 1200 } ],
  "contentGroups":  [ { "source": "tiktok", "content_id": "…", "group_id": "g_…" } ],
  "videoHistory":   [ { "content_id": "…", "observed_date": "…", "title": "…", "views": 1200 } ],
  "videoHistoryTruncated": false,
  "runs": [                          // last 30 sync runs
    { "id": "…", "source": "website", "started_at": "…", "finished_at": "…", "status": "success", "message": "…" }
  ],
  "accounts": [ { "provider": "youtube", "updated_at": "…" } ],   // connected OAuth accounts (never tokens)
  "oauth": { "youtube": true, "tiktok": false, "instagram": false, "facebook": false },  // app credentials present
  "connectors": { "website": true, "websiteProvider": "cloudflare", "github": false, "apple": false,
                  "youtube": true, "instagram": false, "facebook": false }
}
```

Field rules a client must respect:

- `source` is one of `app-store`, `google-play`, `youtube`, `instagram`, `tiktok`, `facebook`, `website`, `github`.
- A metric ending in `_snapshot`, and every value in `content`/`contentHistory`/`videoHistory`, is an **observed
  total** on that date. Do not add those across dates; show the latest, or compare two dates.
- Other metrics are amounts **for that date** in the row's `timezone`; summing a range of dates is fine.
- A missing row means unknown, not zero. `null` in content means the provider did not report it.
- `unit` is usually `count`; others include `minutes` and `rank` (lower is better).
- `web/src/lib/metrics.ts` implements all of this for the web UI (tiles, period changes, labels). Port its pure
  functions rather than re-deriving the rules.

## Writing

Every `POST` must send `Content-Type: application/json` **and** an `Origin` header equal to the dashboard's own
origin (for example `Origin: https://dash.example.com`), or `PUBLIC_URL` when that is set. Browsers do this
automatically; other clients must set it.
Anything else gets `403`.

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/import` | Array of 1–5,000 metric rows: `source`, `date` (`YYYY-MM-DD`), `metric` (`^[a-z][a-z0-9_]{0,63}$`), `value` (≥ 0), `unit`, `timezone` (IANA), `provenance`. Max 2 MB. | `{"imported": n}`. Replaces existing rows with the same source, date and metric. All or nothing. |
| `POST /api/sync/<source>` | `{}` | `202 {"started": true}`; the sync runs in the background. `409` if one is already running. `<source>`: `website`, `app-store`, `youtube`, `tiktok`, `instagram`, `facebook`, `github`. |
| `POST /api/connect/<provider>` | `{}` | `{"url": "…"}`; open it in a browser. Also sets a 10-minute `oauth_binding` cookie; the callback must arrive in the same browser. `<provider>`: `youtube`, `tiktok`, `instagram`, `facebook`. |
| `POST /api/disconnect/<provider>` | `{}` | `{"disconnected": true}`. Deletes stored tokens; keeps collected data. |
| `POST /api/content/group` | `{"items": [{"source","content_id"}…] (1–20), "group_id": "g_<uuid>" \| "solo:<source>:<id>" \| null}` | `{"saved": n}`. Groups the same post across platforms; `null` returns items to automatic grouping. |

Errors are `{"error": "message"}` with a 4xx/5xx status. Messages are safe to show to users.

## Other routes

- `GET /` serves the web app; `GET /app/assets/*` and `GET /fonts/*.woff2` serve its files.
- `GET /oauth/<provider>/callback` is the OAuth redirect target. Register
  `https://<your host>/oauth/<provider>/callback` with each provider.
- Local only: `GET /__scheduled?cron=<expression>` runs a cron trigger (`npm run dev` and `npm run selfhost`).
