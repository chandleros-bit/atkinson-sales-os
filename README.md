# Atkinson Sales OS — Phase 1

Dual-business sales dashboard shell for MPG (merchant services, blue #26ABE0) and Bayway Mortgage (green #0B5E42 / #7CAD44). Read-only v1 per spec.

Phase 1 delivers: app shell, design system, grouped sidebar, global All / MPG / Bayway business filter, and Supabase auth. Later-phase screens are routed as labeled placeholders.

## Stack

- React 18 + Vite 5
- Tailwind CSS 3 with the spec's token system (CSS variables in `src/index.css`)
- React Router 6
- Supabase JS client for auth (data sync lands in Phase 2)
- Deploys to Netlify (`netlify.toml` included, SPA redirect configured)

## Run locally

```bash
npm install
npm run dev
```

With no `.env` file the app runs in **demo mode**: no login required, a banner notes that Supabase is not connected. This lets you preview the shell immediately.

## Connect Supabase (enables real sign-in)

1. Create a project at supabase.com (or reuse an existing one).
2. In the dashboard: **Authentication → Users → Add user**. Create your account with email + password. Turn off public signups under Authentication → Providers → Email if you want it locked to just you.
3. Copy `.env.example` to `.env` and fill in from **Project Settings → API**:
   ```
   VITE_SUPABASE_URL=https://YOURPROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. Restart `npm run dev`. You'll get the login screen; sign in with the user you created.

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. Netlify → Add new site → Import from GitHub. Build settings are read from `netlify.toml`.
3. Add the two `VITE_` env vars under **Site configuration → Environment variables** (do not commit `.env`).

## Project layout

```
supabase/
  migrations/0001_init.sql   Normalized schema + read-only RLS
  functions/
    _shared/db.ts            Service-role client + sync_log helper
    _shared/fub.ts            FollowUpBoss API client + field mapping
    fub-sync/                 Scheduled sync (pipelines/stages, people, deals)
    fub-webhook/               Near-real-time webhook receiver
docs/
  phase2-fub-setup.md        Secrets, deploy, cron, webhook registration
src/
  index.css              Design tokens (both brand palettes) + Tailwind
  main.jsx               Entry
  App.jsx                Routes + auth guard
  lib/supabase.js        Supabase client, demo-mode detection
  context/
    AuthContext.jsx      Session state, signIn/signOut
    BusinessContext.jsx  All/MPG/Bayway filter, accent theming, matches()
  components/
    Layout.jsx           Sidebar + main outlet + demo banner
    Sidebar.jsx          Grouped nav, New Task, profile, sign out
    BusinessFilter.jsx   Segmented All/MPG/Bayway control
    BizBadge.jsx         Colored business tag for rows
    PagePlaceholder.jsx  Stub for later-phase routes
  pages/
    Login.jsx            Email/password sign-in
    Overview.jsx         Phase 1 shell version (placeholder rows)
    SyncStatus.jsx       Live per-source sync health (Phase 2)
```

## How the color system works

- Neutral dark chrome everywhere; business identity is carried by accents only.
- `BusinessContext` sets `data-biz` on `<html>` when filtered to one business, which swaps the `--accent` CSS variable. In All mode, dual-brand elements use the blue-to-green gradient.
- Row-level color (stripes, badges, stage pills) always comes from the row's own business, never from the current filter, so nothing is ever mislabeled.
- Rule from the spec: MPG blue and Bayway green never appear on the same element.

## Phase roadmap (from the build spec)

Delivered work expanded past the original 7-phase outline as MPG (Zoho) and
Bayway (FollowUpBoss) turned out to need separate, parallel tracks. Status as
of 2026-07-13:

- **Phase 2 — done (FollowUpBoss):** Supabase schema (`supabase/migrations/0001_init.sql`),
  scheduled sync + webhook Edge Functions (`supabase/functions/fub-sync`,
  `supabase/functions/fub-webhook`), live Sync Status screen at `/sync`. Setup:
  `docs/phase2-fub-setup.md`. **Live**, syncing every 15 min (~826 Bayway contacts).
- **Phase 3 — done:** Bayway "Command Center" Overview (`v_active_pipeline` view,
  `src/lib/overview.js`) from synced data.
- **Phase 4 — done:** Bayway pipeline board (`Pipeline.jsx`, loan-flow columns
  New Lead → Attempted → App Sent → Waiting on Docs → Pre-Approved, lost rightmost).
- **Phase 5 — deployed, awaiting secrets:** Zoho (MPG) sync backend (`zoho-sync`
  function, `_shared/zoho.ts`, cron). Setup: `docs/phase5-zoho-setup.md`. Code is
  live but automated runs are off until `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN` are
  set; MPG's 3 Zoho leads were synced manually in the meantime.
- **Phase 6 — done:** Bayway Contacts screen (`v_bayway_contacts`, `Contacts.jsx`;
  search, All/Active/Nurture filters, sort, pagination).
- **Phase 7 — done:** MPG Contacts, generalized `Contacts.jsx` into a
  config-driven `CONFIGS[biz]`/`COLUMNS` registry shared by both businesses
  (`v_mpg_contacts` view).
- **Phase 8 — done, live:** Merged calendar — Outlook ICS sync (`outlook-sync`
  function, recurrence expansion, cron) feeding a day-grouped agenda at
  `/calendar`. Setup: `docs/phase8-outlook-setup.md`.
- **Phase 9 — done, pushed, not yet visually verified live:** MPG Overview +
  Pipeline, reusing the Phase 3/4 components via a data-driven config
  (`PIPELINE[biz]`, `MPG_LEAD_FLOW`). MPG reality: 3 open Zoho leads, 0 deals.
- **Phase 10 — done, pushed, not yet visually verified live:** Combined `All`
  Overview merging both books into one dispatcher-based `Overview.jsx`
  (`DemoOverview`/`MpgOverview`/`BayOverview`/`AllOverview`) with shared KPI/
  attention-list components.
- **Phase 11 — done (committed, backend awaiting deploy):** Bayway Activity
  feed — a day-grouped timeline of calls/texts/emails/notes/appointments with
  type-filter chips and "Load older" pagination. New `fub-activity-sync`
  function + `v_bayway_activity` view + `Activity.jsx` screen at
  `/bayway/activity` (`src/lib/activity.js` helpers). Deploy/verify:
  `docs/phase-activity-fub-setup.md`. MPG activity (Zoho) remains a future
  phase; `/mpg/activity` stays a placeholder.

### Not yet built

- **Reports** — not started. No time dimension exists yet (contacts have no
  `created_at`; `deals`/`metrics_daily` are empty), so this has to ship as a
  snapshot/state-of-the-book screen (stage distribution, active-vs-nurture,
  last-touch recency), not a trends/revenue-timeline view. No chart library
  installed yet.
- **Deals sync** (FUB + Zoho → `deals` table, currently empty) — not started.
  Biggest visible gap vs. the original mockup: unlocks the dollar KPI row
  (Active deals $, Pipeline value, Closed-this-month).
- **MPG (Zoho) activity** — the Bayway activity feed shipped in Phase 11; the
  MPG side still needs a Zoho activity sync before `/mpg/activity` can light up.
- **Targets and polish** (original Phase 7 scope) — not started.

Locked scope for v1: read-only, CRM + calendar sources only, dark theme, single Super Admin user.
