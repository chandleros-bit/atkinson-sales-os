# Phase 8 — Outlook calendar setup (published ICS feeds)

This connects your two Outlook calendars to the dashboard's Calendar screen using
**published calendar links** (ICS) — no Azure app, no OAuth, no passwords. Read-only:
the app only reads the feeds and never writes to Outlook.

Do this once per Outlook login (MPG and Bayway).

## 1. Publish each calendar and copy its ICS link

For **each** Outlook account:

1. Open **Outlook on the web** (outlook.office.com) signed in to that account.
2. **Settings (gear) → Calendar → Shared calendars**.
3. Under **Publish a calendar**, pick the calendar, set permission to
   **"Can view all details"**, click **Publish**.
4. Copy the **ICS** link (ends in `.ics`).

You'll end up with two links — one from the MPG login, one from the Bayway login.

## 2. Set the two links as function secrets

```bash
supabase secrets set OUTLOOK_MPG_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
supabase secrets set OUTLOOK_BAYWAY_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
```

(Keep these links private — anyone with the link can read that calendar.)

## 3. Trigger a sync and check

The function is deployed and runs every 15 minutes. Trigger one now:

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

(`YOUR_ANON_KEY` = Supabase → Project Settings → API → anon public.)

Open **Sync Status**: before the secrets are set, "Outlook — MPG" and "Outlook — Bayway"
show a "not set" error; after, they flip to a synced count. Then open **Calendar** to see
the merged agenda (use the All / MPG / Bayway filter to scope it).

## Notes

- **Refresh lag:** Microsoft updates a published ICS feed on its own schedule (often a few
  hours), so new Outlook events may take a while to appear. That's a limitation of published
  feeds, not the sync.
- **Window:** the sync pulls events for the next ~60 days and expands recurring events.
- **Only one login has calendars?** Set just the one URL; the other feed stays "not set" and
  is harmless.
