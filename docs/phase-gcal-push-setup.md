# Google Calendar push setup

Sends every call, meeting and timed follow-up you schedule in Sales OS
(`contact_events`) to a Google Calendar, every 5 minutes. Outlook then shows
them by subscribing to that Google calendar, since the work Outlook calendars
can't be written to.

- One-way: Sales OS to Google. Editing the event in Google does not change Sales OS.
- Reschedule in Sales OS: the Google event moves. Cancel: it's removed.
  Mark done: it stays, with a check mark in the title.
- Only events Sales OS created are touched. Anything you add to that calendar
  by hand is left alone.
- Only the owner's events are pushed, not the assistant's.
- Window: yesterday through the next 60 days.

## 1. Google Cloud service account

`sheets-docs-sync` was retired on 2026-11-05 (migration 0057 moved borrower
docs into the OS and unscheduled it). Its service account and the
`GOOGLE_SERVICE_ACCOUNT_JSON` secret may still exist and can be reused here.
Nothing else uses them now.

1. In Google Cloud, open the project that held the old docs-sync service
   account (or make a new project), go to APIs & Services > Library and enable
   **Google Calendar API**.
2. If that service account or its key is gone, or you'd rather start clean:
   create a service account, create a **JSON key**, and set it as a secret
   (this overwrites the old one, which is fine):
   `supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/key.json)"`
3. Copy the service account's email (`...@...iam.gserviceaccount.com`).

## 2. Share the calendar with the service account

Signed in as Chandler.dashboard@gmail.com, in Google Calendar on the web:

1. Settings > pick the calendar (the main one, or make a new one such as
   "Sales OS" so these events stay separate).
2. Share with specific people > add the service account email >
   **Make changes to events**.
3. Under Integrate calendar, copy the **Calendar ID** (for the main calendar
   it's `chandler.dashboard@gmail.com`).

## 3. Secrets, deploy, schedule

```
supabase secrets set GOOGLE_CALENDAR_ID=chandler.dashboard@gmail.com
supabase functions deploy gcal-push --no-verify-jwt
supabase db push   # applies 0062_schedule_gcal_push.sql (cron every 5 min)
```

Test once by hand:

```
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/gcal-push
```

The Sync Status page shows a "Google Calendar push" row with the counts.

## 4. See it in Outlook

1. In Google Calendar settings for that calendar, under Integrate calendar,
   copy **Secret address in iCal format**. Keep it private: anyone with the
   link can read the calendar.
2. In Outlook: Add calendar > Subscribe from web > paste the link.

Outlook refreshes subscribed calendars on its own schedule, often every few
hours, so new events can show up in Outlook later than in Google. Google
Calendar on your phone is instant. If your company blocks internet calendar
subscriptions, the Outlook step won't work; the Google side still will.

## Troubleshooting

- `GOOGLE_CALENDAR_ID not set`: step 3.
- `google token exchange failed`: bad or rotated key in
  `GOOGLE_SERVICE_ACCOUNT_JSON`.
- `google list failed: 403` or `404`: the Calendar API isn't enabled, or the
  calendar isn't shared with the service account (with Make changes to events).
- `refusing to delete N Google events`: Sales OS returned no events while
  Google still had several. Nothing was deleted; check the database.
