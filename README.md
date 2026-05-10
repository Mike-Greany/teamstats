# TeamStats

Multi-team softball/baseball stats PWA. A scalable rebuild of the single-team Teddy 10U Apps Script app.

## Stack

- **Frontend:** vanilla JS PWA, hosted on Cloudflare Pages (free)
- **Backend:** Supabase (Auth + Postgres + Storage; free tier)
- **No custom server code:** the frontend talks directly to Supabase via `@supabase/supabase-js`. Multi-tenant isolation enforced by Postgres Row-Level Security.

## Repo layout

```
teamstats/
├── public/                     ← static assets served by Cloudflare Pages
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                   ← service worker (true PWA)
│   └── icons/
├── src/                        ← JS source, no build step (loaded by index.html)
│   ├── styles.css
│   ├── app.js                  ← entry: routing, state, auth bootstrap
│   ├── api.js                  ← thin wrappers around supabase queries
│   ├── parseNote.js            ← BR-shorthand parser (port from old ParseNote.gs)
│   └── views/                  ← per-page renderers
└── supabase/
    └── migrations/
        └── 0001_init.sql       ← schema + RLS policies
```

## Phased build

| Phase | Status | Doc |
|---|---|---|
| 1 — Supabase setup | ⏳ in progress | [PHASE_1_SUPABASE_SETUP.md](./PHASE_1_SUPABASE_SETUP.md) |
| 2 — Cloudflare Pages + GitHub | pending | (Phase 2 doc when Phase 1 completes) |
| 3 — Auth shell | pending | |
| 4 — Team creation wizard | pending | |
| 5 — Roster + schedule CRUD | pending | |
| 6 — Game log + Team batting | pending | |
| 7 — Player profile + edit | pending | |
| 8 — Lineup builder | pending | |
| 9 — Settings + theming | pending | |
| 10 — Migrate Teddy 10U + ship | pending | |

## Cost (sanity)

- Supabase free tier: 500 MB DB / 1 GB Storage / 50K MAU → fits ~50 teams comfortably
- Cloudflare Pages free: unlimited static traffic
- Custom domain (optional): ~$10/year
- **Total at small scale: $0**

## Existing Teddy 10U app

Stays live on Apps Script through end-of-season (5/27). Migration of that team's data happens in Phase 10. The two apps run in parallel — no rush, no downtime.
