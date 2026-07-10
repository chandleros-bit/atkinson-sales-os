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
```

## How the color system works

- Neutral dark chrome everywhere; business identity is carried by accents only.
- `BusinessContext` sets `data-biz` on `<html>` when filtered to one business, which swaps the `--accent` CSS variable. In All mode, dual-brand elements use the blue-to-green gradient.
- Row-level color (stripes, badges, stage pills) always comes from the row's own business, never from the current filter, so nothing is ever mislabeled.
- Rule from the spec: MPG blue and Bayway green never appear on the same element.

## Phase roadmap (from the build spec)

- **Phase 2 — next:** sync layer. FollowUpBoss first, then Zoho, then Microsoft Graph x2. Supabase schema, cron polling (15 min) + webhooks, Sync Status screen.
- Phase 3: real Overview (KPI cards, workbench, alert banner) from synced data.
- Phase 4: MPG and Bayway pipeline boards.
- Phase 5: merged calendar.
- Phase 6: contacts, activity, reports.
- Phase 7: targets and polish.

Locked scope for v1: read-only, CRM + calendar sources only, dark theme, single Super Admin user.
