# Contact events + reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule a call/meeting from a contact, show it on the calendar views, and pop up a reminder before it starts.

**Architecture:** App-owned `contact_events` table (RLS, per user). Pure helpers in `src/lib/contactEvents.js`; UI in `src/components/ScheduleEvent.jsx` and `src/components/ReminderHost.jsx`; Calendar page and TodayAgenda merge the rows into their Outlook lists. Spec: `docs/superpowers/specs/2026-10-29-contact-events-design.md`.

**Tech Stack:** React 18 + Vite + Tailwind, Supabase JS, Vitest + Testing Library.

---

## Files

- Create `supabase/migrations/0045_contact_events.sql` — table, index, RLS, touch trigger.
- Create `src/lib/contactEvents.js` + `src/lib/contactEvents.test.js` — row builder, calendar mapping, labels, CRM note text, `dueReminders`, Supabase calls, change bus.
- Modify `src/lib/calendar.js` (+ test) — `sourceToBiz` knows `os-mpg` / `os-bay`.
- Create `src/components/ScheduleEvent.jsx` + `ScheduleEvent.render.test.jsx` — form, button, upcoming list.
- Create `src/components/ReminderHost.jsx` + `ReminderHost.render.test.jsx` — pop-up + Notification.
- Modify `src/components/Layout.jsx` — mount `ReminderHost`.
- Modify `src/components/PersonSheet.jsx` — Schedule button + Upcoming.
- Modify `src/pages/Contacts.jsx` — per-row schedule button.
- Modify `src/pages/Calendar.jsx`, `src/components/TodayAgenda.jsx` — fetch + merge OS events; click opens contact.

## Tasks

### Task 1: Migration
- [ ] Write `0045_contact_events.sql` per spec (columns, checks, `(user_id, starts_at)` index, four own-row policies, `contact_events_touch` trigger setting `updated_at`).
- [ ] Commit `feat: contact_events table`.

### Task 2: Pure helpers (TDD)
- [ ] Tests first in `contactEvents.test.js`:
  - `buildEventRow` builds `{ business_id, contact_id, kind, starts_at, duration_min, remind_min, note }` from `{ dayKey:'2026-10-30', time:'14:30' }` as local time; throws on missing contact, bad kind, bad time, past start.
  - `toCalendarEvent` gives `source_account:'os-mpg'`, title `Call · Jane Doe`, `ends_at = starts_at + duration`, `os:true`, `contact_id`.
  - `crmNoteBody` → `Scheduled call Thu 10/30 2:30 PM · 30 min — bring rates`.
  - `dueReminders`: excluded before window, included at window start, included at start + 4 min, excluded at start + 5 min, excluded when `remind_min` null / `reminded_at` set / id fired / status not scheduled.
  - `defaultStartTime(now)` → next half hour as `HH:MM`.
  - `sourceToBiz('os-bay') === 'bay'`.
- [ ] Run `npx vitest run src/lib/contactEvents.test.js src/lib/calendar.test.js` — FAIL.
- [ ] Implement; run — PASS. Commit.

### Task 3: Schedule form + entry points
- [ ] Render test: fill form, submit, expect `insertContactEvent` called with built row; with CRM box checked, expect `invokeCrmAction` with `add_note`; unchecked, not called.
- [ ] Implement `ScheduleEventForm`, `ScheduleButton`, `UpcomingEvents`.
- [ ] Wire into PersonSheet (button + Upcoming) and Contacts rows.
- [ ] Run tests — PASS. Commit.

### Task 4: Calendar merge
- [ ] Calendar page + TodayAgenda: `fetchContactEvents({from,to})` alongside the Outlook query, `toCalendarEvent` each, concat. OS rows: "OS" tag, note line, button opening `openPerson(contact_id)`; done rows dimmed. Demo mode: no OS rows.
- [ ] Update `Overview.render.test.jsx` mock if the new table query breaks it. Run full suite. Commit.

### Task 5: Reminders
- [ ] Render test with fake timers: event starting in 12 min with `remind_min:10` — no card at t0, card after 2 min + tick; Dismiss hides it; `markReminded` called once.
- [ ] Implement `ReminderHost` (load every 5 min + on bus, check every 30 s, card stack, Notification when granted, localStorage fired-ids guard, snooze 5 min, "Turn on desktop alerts").
- [ ] Mount in Layout. Run tests — PASS. Commit.

### Task 6: Verify + ship
- [ ] `npx vitest run` — only the 5 known SearchPalette/Workbench unhandled errors.
- [ ] `npx vite build` passes.
- [ ] Browser: dev server, schedule an event, see it on Calendar/Today, see the reminder.
- [ ] Push branch, open PR to `main`. Migration `supabase db push --linked` only after user OK.
