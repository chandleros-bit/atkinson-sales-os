# Contact events + reminders — design

Date: 2026-10-29. Branch: `feat/contact-events`.

## Goal

From a contact, schedule a call or meeting ("call with Jane Doe, Thu 2:30 PM,
30 min") and get a pop-up reminder a few minutes before it. Works for both
books (MPG / Bayway). The events show on the Calendar page and the Overview
"Today's Events" card next to the Outlook events.

## Decisions (settled with the user)

- **Storage:** a new app-owned Supabase table, `contact_events`. Nothing is
  written to Outlook (the ICS feeds are read-only), Zoho or Follow Up Boss as
  an event.
- **CRM note:** the form has an "Add note in Zoho/FUB" checkbox, checked by
  default, that drops a note on the lead through the existing `add_note`
  crm-action ("Scheduled call Thu 10/30 2:30 PM · 30 min — <note>"). Hidden
  when write-back is off for that book. The event is saved first; a failed note
  shows an error toast with Retry and never undoes the event.
- **Reminders:** only while an OS tab is open (foreground or background). No
  service worker or push server.
- **Lead time:** per event, picker None / 5 / 10 / 15 / 30 / 60 min, default 10.

## Data — migration `0045_contact_events.sql`

```
contact_events
  id           uuid pk default gen_random_uuid()
  user_id      uuid not null default auth.uid()
  business_id  text not null references businesses(id)
  contact_id   uuid not null references contacts(id) on delete cascade
  kind         text not null check (kind in ('call','meeting'))
  starts_at    timestamptz not null
  duration_min int not null default 30 check (duration_min between 5 and 480)
  note         text
  remind_min   int check (remind_min is null or remind_min between 0 and 1440)
  status       text not null default 'scheduled' check (status in ('scheduled','done','canceled'))
  reminded_at  timestamptz
  created_at / updated_at timestamptz default now()
```

Index `(user_id, starts_at)`. RLS: own rows only (select / insert / update /
delete), same policies as `work_items`. `updated_at` trigger.

## Units

- `src/lib/contactEvents.js` (pure, no I/O except the fetch helpers):
  - `buildEventRow(form)` — validates and turns the form into an insert row
    (date key + "HH:MM" local → `starts_at` ISO).
  - `toCalendarEvent(row)` — maps a row (with `contacts(name)`) to the shape
    the calendar views render: `source_account` `os-mpg` / `os-bay`, title
    "Call · Jane Doe", `ends_at` from duration, `contact_id`, `is_all_day:false`,
    `os: true`.
  - `eventWhenLabel(iso)` — "Thu 10/30 2:30 PM".
  - `crmNoteBody(row)` — the CRM note text.
  - `dueReminders(rows, now, firedIds)` — scheduled events whose reminder
    window is open: `remind_min != null`, `reminded_at` null, id not already
    fired, `starts_at − remind_min ≤ now < starts_at + 5 min`.
  - `fetchContactEvents({ from, to })`, `fetchContactUpcoming(contactId)`,
    `insertContactEvent`, `setContactEventStatus`, `markReminded` — thin
    Supabase calls.
  - A tiny event bus: `notifyContactEventsChanged()` / `onContactEventsChanged(fn)`
    (window CustomEvent `contact-events:changed`).
- `sourceToBiz` in `calendar.js` also maps `os-mpg` / `os-bay`.
- `src/components/ScheduleEvent.jsx`:
  - `ScheduleEventForm` — Call / Meeting chips, date presets (Today, Tomorrow,
    pick date), time input (default next half hour), duration chips
    (15 / 30 / 45 / 60), Remind me select (default 10), note, CRM note checkbox.
  - `ScheduleButton` — opens the form in the shared `Sheet`.
  - `UpcomingEvents` — the contact's scheduled events with Done / Cancel.
- `src/components/ReminderHost.jsx` — mounted once in Layout. Loads scheduled
  events for [now − 10 min, now + 26 h], re-loads every 5 min and on the bus,
  checks `dueReminders` every 30 s. A due reminder:
  - shows a pop-up card (top-right, stays until dismissed): kind, contact name,
    time ("in 10 min" / "now"), buttons Open contact (`openPerson`), Snooze
    5 min, Dismiss;
  - fires a browser `Notification` when permission is `granted`; clicking it
    focuses the tab and opens the contact;
  - writes `reminded_at` (fires once across tabs and devices) and records the
    id in `localStorage` so two open tabs don't both fire before the write lands.
  - Snooze is local: re-shows the card 5 minutes later.
  - "Turn on desktop alerts" link in the card asks for Notification permission
    (never on page load).

## Where it appears

- PersonSheet: "Schedule" button next to Quick Actions (shown whether or not
  write-back is on) and an "Upcoming" list under the contact info.
- Contacts page: a calendar button on each row (desktop and mobile) that opens
  the schedule sheet.
- Calendar page and TodayAgenda: fetch `contact_events` for the same window,
  merge with Outlook rows. OS events get a small "OS" tag, show the note as the
  second line, and clicking one opens the contact. Canceled events are not
  fetched; done ones show dimmed.

## Errors

- Insert fails: the form shows the message and stays open.
- CRM note fails: event kept; toast "Scheduled — note not added to Zoho" with Retry.
- Reminder fetch fails: silently retried on the next 5-minute load.
- `reminded_at` write fails: the localStorage guard still stops repeats in
  this browser.

## Testing

- `contactEvents.test.js`: buildEventRow (validation, local time → ISO),
  toCalendarEvent, crmNoteBody, dueReminders window edges, sourceToBiz.
- `ScheduleEvent.render.test.jsx`: form submits the right row; CRM note sent
  only when checked.
- `ReminderHost.render.test.jsx`: fake timers; card appears inside the window,
  not before; Dismiss and Open contact.
- Manual: dev server, schedule an event 11 minutes out with a 10-minute
  reminder, see it on Calendar / Today, see the pop-up.

## Out of scope

Pushing events to Outlook / Zoho Events / FUB appointments; reminders while
the app is closed (Web Push); editing an event's time (cancel and re-create).
