# Sales OS Power Dialer Spec

Nov 20, 2026 · @Chandler Atkinson

## Overview

Add a Power Dialer page to Atkinson Sales OS: drop in a CSV, tag it MPG or Bayway, and work the list one call at a time from the iPhone browser. Nothing goes to Zoho or FollowUpBoss until a lead hits a confirmed outcome and Chandler approves it in a review queue.

Goals:

- Get from a raw list to the first dial in under 2 minutes
- Keep cold prospects out of Zoho and FUB so both CRMs stay clean
- Count every dial and connect toward the separate MPG and Bayway daily targets already spec'd
- Never call a number twice by accident: CRM duplicates and Do Not Call numbers are caught on upload

Out of scope for v1: browser calling (Twilio), voicemail drop, call recording, multi-line dialing, and any automatic SMS from FUB.

## Decisions

These were settled with Chandler on Nov 20, 2026 and should not be reopened during the build.

| Topic | Decision |
| --- | --- |
| How calls are placed | `tel:` links. The iPhone dials from Chandler's own number. No Twilio, no per-minute cost. |
| Dial pace | One at a time. Log an outcome, the next lead loads, one tap to dial. |
| Device | iPhone browser first (mobile layout). Desktop should still work. |
| CSV import | Auto-detect columns, Chandler confirms the mapping before the list loads. |
| Business tag | Every list is MPG or Bayway. Bayway lists are also tagged Cold or Warm. |
| Confirmed outcomes | Interested, Appointment set, Callback requested, Application sent (Bayway only). |
| CRM push | Confirmed leads go to a Ready to Push review queue. Nothing is created in Zoho or FUB until Chandler approves. |
| MPG landing | Zoho Lead, status Open, call notes attached. |
| Bayway landing | FUB person, source `CA Power Dialer`, a `CA` tag, call notes. Sales OS stage by outcome: Application sent goes to Application/Estimate Sent, the rest go to Contacted/Working. |
| Non-confirmed leads | No answer and voicemail retry later. DNC blocks the number forever. Numbers already in Zoho or FUB are flagged on upload. |
| On-screen extras | Call script per business, session stats, callback scheduling, quick text/email follow-up. |
| Delivery | This spec, handed to Claude Code. Repo: github.com/chandleros-bit/atkinson-sales-os. |

## How it works

&#91;embedded content: power dialer flow · upload to CRM\]

Every lead loops through the dial queue until it lands in one of three places: retry, dead, or Ready to Push. Only the last path touches Zoho or FUB, and only after Chandler approves it.

## Data model

Seven new Supabase tables, all prefixed `dialer_` except the shared DNC list. Every row carries `business` (`mpg` or `bayway`) so the existing All/MPG/Bayway toggle filters it. RLS: owner-only, same pattern as the `tasks` table.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `dialer_lists` | One row per uploaded CSV | `id`, `business`, `temperature` (`cold` / `warm`, Bayway only), `name`, `source_filename`, `column_mapping` jsonb, `status` (`active` / `completed` / `archived`), `created_at` |
| `dialer_leads` | One row per person on a list | `id`, `list_id`, `business`, `first_name`, `last_name`, `company`, `phone_raw`, `phone_e164`, `email`, `address`, `city`, `state`, `zip`, `extra` jsonb (unmapped columns), `status`, `attempt_count`, `last_outcome`, `next_attempt_at`, `crm_match` jsonb, `position` |
| `dialer_calls` | One row per logged dial | `id`, `lead_id`, `list_id`, `session_id`, `business`, `outcome`, `notes`, `dialed_at`, `logged_at` |
| `dialer_sessions` | One row per dialing session | `id`, `business`, `list_id`, `started_at`, `ended_at` (counts are derived from `dialer_calls`) |
| `dialer_push_queue` | Ready to Push review queue | `id`, `lead_id`, `business`, `target` (`zoho` / `fub`), `outcome`, `payload` jsonb, `status` (`pending` / `approved` / `pushed` / `failed` / `skipped`), `crm_record_id`, `error`, `approved_at`, `pushed_at` |
| `dialer_scripts` | Editable call script | `business` (PK), `body` (markdown), `updated_at` |
| `dnc_numbers` | Shared Do Not Call list | `phone_e164` (PK), `reason`, `source` (`dialer` / `manual` / `import`), `added_at` |

Lead `status` values: `queued`, `retry`, `confirmed`, `pushed`, `dead`, `dnc`, `crm_duplicate`, `invalid_phone`.

Outcomes, and what each does:

| Outcome | Counts as connect | Lead status after | Other effect |
| --- | --- | --- | --- |
| No answer | No | `retry` | Next attempt scheduled |
| Left voicemail | No | `retry` | Next attempt scheduled |
| Owner not available (MPG) | Yes | `retry` | Next attempt scheduled |
| Bad number | No | `invalid_phone` | Removed from rotation |
| Not interested | Yes | `dead` | None |
| Do Not Call | Yes | `dnc` | Number added to `dnc_numbers` |
| Callback requested | Yes | `confirmed` | Date/time picker, Sales OS task, Google Calendar event, push queue row |
| Interested | Yes | `confirmed` | Push queue row |
| Appointment set | Yes | `confirmed` | Push queue row, prompt to send Calendly link |
| Application sent (Bayway) | Yes | `confirmed` | Push queue row, prompt to send application link |

Retry rule: a `retry` lead comes back up to 3 total attempts. The next attempt waits at least 4 hours and lands in the other half of the day (a morning miss retries in the afternoon, and the reverse). After the third miss the lead goes to `dead`.

Daily numbers: every `dialer_calls` row counts as a dial, and connect outcomes count as conversations, toward that business's daily target. If the separate MPG/Bayway targets feature is already built, write into its activity source. If not, that feature should read from `dialer_calls`.

## Screens

One new sidebar item, Power Dialer, with four views. Use the existing light theme, design tokens, MPG blue and Bayway green. Mobile-first: thumb-reachable buttons at the bottom, nothing that needs hover.

**1. Lists (home of the page)**

- Card per list: name, business color, Cold/Warm badge (Bayway), progress (worked / total), confirmed count, last dialed date
- Upload CSV button (top) and Ready to Push count badge linking to the queue
- Filtered by the All/MPG/Bayway toggle
- Archive a finished list. Its call history stays for reporting.

**2. Upload and map**

1. Pick file, pick MPG or Bayway, and for Bayway pick Cold or Warm
2. Parse in the browser (PapaParse). Auto-map headers by fuzzy match: phone, mobile, cell, owner name, first/last name, business name, company, email, address, city, state, zip
3. Show a mapping screen with the first 3 rows as a preview. Phone is required. Unmapped columns are kept in `extra` and shown on the lead card.
4. Normalize phones to E.164 (US default). Rows with no valid phone are marked `invalid_phone`.
5. Run the checks (next section) and show a summary before saving: total, ready to dial, already in CRM, on DNC, bad phone, duplicates inside the file
6. Save. Dialing order is the CSV order.

**3. Dial screen**

- Top: list name, session stats (dials, connects, confirmed for this session, plus today's total against the business's daily target)
- Lead card: name, company, phone, city/state, any `extra` fields, attempt number, notes from past attempts on this list
- Big Call button: a `tel:` link. Tapping it creates the `dialer_calls` row with `dialed_at`.
- Script drawer: slides up over the card, shows that business's script, editable in Settings
- Outcome buttons (shown after Call is tapped): the outcome list from the data model, MPG-only and Bayway-only outcomes hidden for the other business
- Notes field, optional, saved with the outcome
- Callback requested opens a date/time picker
- After an outcome is saved: optional follow-up row (below), then the next lead loads. Skip and Back buttons are available.
- The queue serves `queued` leads first, then `retry` leads whose `next_attempt_at` has passed

**Quick follow-up** (after Interested, Appointment set, Callback requested, Application sent)

- Text button: `sms:` link that opens iMessage with a prefilled message
- Email button: `mailto:` link with subject and body prefilled
- Templates per business, editable in Settings. Bayway templates include the application link (https://baywayhtx.my1003app.com/1851744/register) and Calendly (https://calendly.com/chandler-baywayhtx/30min). MPG templates include Chandler's MPG email and phone.

**4. Ready to Push queue**

- Row per confirmed lead: name, business, outcome, notes, the CRM match result, and the exact fields that will be written
- Edit fields before pushing
- Approve (single or select all), Skip (keeps the lead in Sales OS only), Retry for failed rows with the error shown

**Settings (small panel on the page)**

- MPG script, Bayway script
- Follow-up text and email templates per business
- Retry rule: max attempts (default 3) and minimum hours between attempts (default 4)
- DNC list: view, search, add a number, remove a number
- Calling hours guard on/off for Cold lists (on by default)

## CRM checks and push

The CRMs are touched in exactly two places: a read-only duplicate check on upload, and a write when Chandler approves a row in the Ready to Push queue. Both run in Deno Edge Functions so API keys never reach the browser.

**Upload check (read only): `dialer-crm-check`**

- Bayway lists: match `phone_e164` against the FUB contacts already synced into Supabase in Phase 2. No live FUB calls needed.
- MPG lists: query Zoho Leads, Contacts and Accounts by phone with COQL in batches of 50 numbers.
- Every list, both businesses: match against `dnc_numbers`.
- A match sets status `crm_duplicate` and stores the record id and owner in `crm_match`. The upload summary shows these. Chandler can include them anyway with one toggle per list (off by default).

**Push on approval: `dialer-crm-push`**

Re-run the duplicate check for that one number right before writing, since time may have passed.

|  | MPG to Zoho | Bayway to FUB |
| --- | --- | --- |
| Record | Zoho Lead | FUB person, created with `POST /v1/people`, not `/v1/events` |
| Status / stage | Lead\_Status = Open | Sales OS pipeline row: Application sent goes to Application/Estimate Sent, everything else to Contacted/Working |
| Source | Lead\_Source = Chandler and MPG\_REP = Chandler (existing picklist values; new ones cannot be added), plus a Description line "Source: Sales OS Power Dialer – <list name>" | source = `CA Power Dialer` |
| Tags | Zoho tag `Power Dialer` | `CA`, `CA Power Dialer`, plus `Cold` or `Warm` from the list |
| Owner | Chandler | Chandler's FUB user |
| Notes | Zoho Note with every logged call on this lead (date, outcome, notes) | FUB note with the same call history |
| Required fields | Last\_Name and Company. Use the CSV company. If blank, use the person's full name. | name and phone |
| If already exists | Add the note to the existing record, do not create a new one | Add the note and the tags to the existing person, do not create a new one |

Why `/v1/people` for FUB: the account is shared, and `/v1/events` sends leads through the shared Lead Flow, which can fire the arrival text and other users' automations. The `CA` drip Action Plans stay off until Chandler turns them on himself. Claude Code should confirm this behavior in the FUB API docs before building.

After a successful push: queue row `pushed`, `crm_record_id` saved, lead status `pushed`. On failure: queue row `failed` with the API error, shown in the queue with a Retry button. A Slack message goes out only on failure.

**Callback requested also creates**

- A Sales OS task in the existing `tasks` table (business set, `task_type` = client, due at the chosen time, title `Callback: <name>`)
- A Google Calendar event on Chandler.dashboard@gmail.com, using the same push path already spec'd for Sales OS scheduled events

These are created when the outcome is logged, not when the push is approved, so the callback is never missed while a row sits in the queue.

## Compliance guardrails

Cold Bayway lists are consumer telephone solicitation, so the dialer enforces calling hours and DNC by default. Warm lists and MPG business lists skip the hours guard but still respect the internal DNC list. These guardrails are app behavior, not legal advice. Chandler should confirm them with Bayway's compliance contact.

Rules the dialer enforces on Cold lists:

| Rule | Why | How the app enforces it |
| --- | --- | --- |
| Call only Mon to Sat 9 AM to 8 PM, Sun 12 PM to 8 PM, in the lead's local time | Texas allows 9 AM to 9 PM Mon to Sat and 12 PM to 9 PM Sun ([Tex. Bus. & Com. Code 301.051](https://statutes.capitol.texas.gov/SOTWDocs/BC/htm/BC.301.htm)). Florida stops at 8 PM and starts at 8 AM ([Fla. Stat. 501.616](https://flsenate.gov/Laws/Statutes/2024/501.616)). One combined window covers both. | Lead time zone comes from the mapped state, falling back to area code. Leads outside the window are skipped in the queue and the Call button is disabled with the reason shown. |
| No more than 3 calls to the same person in 24 hours | Florida limit on commercial solicitation calls on the same subject | The retry rule (4 hours apart, 3 attempts max) already stays under this. Add a hard check that blocks a 4th dial in any 24 hours. |
| National Do Not Call Registry | Federal rule for consumer telemarketing. The app cannot check the registry itself without a paid registry subscription. | Cold Bayway uploads require a checkbox: "This list was scrubbed against the National DNC Registry" (most list sources, including property-data tools, offer a scrub). The list stores who confirmed it and when. |
| Internal Do Not Call | Anyone who asks not to be called again | The Do Not Call outcome writes to `dnc_numbers`. Every upload, for both businesses, removes those numbers. |
| Manual dialing only | Automated dialing raises consent requirements in Florida and federally | Every call is a human tap on a `tel:` link. No auto-dial, no countdown, no parallel lines. |

If Twilio or auto-dialing is ever added, this section needs a fresh review before that build starts.

## Implementation plan

Build in this order. Each phase ships on its own and is usable before the next starts.

1. **Schema.** Migration for the 7 tables, RLS, indexes on `dialer_leads(list_id, status, next_attempt_at)` and `dialer_calls(business, dialed_at)`. Seed both scripts and follow-up templates with placeholder text.
2. **Upload and map.** PapaParse, header auto-mapping, phone normalization (libphonenumber-js), in-file duplicate check, DNC check, Cold/Warm and DNC-scrub checkbox for Bayway. No CRM calls yet.
3. **Dial screen.** Queue logic, `tel:` Call button, outcome buttons, notes, retry scheduling, session stats, script drawer, Skip/Back. Write calls into the daily-numbers source.
4. **Compliance guard.** Time zone from state or area code, calling window, 3-in-24-hours block.
5. **Follow-ups and callbacks.** `sms:` and `mailto:` templates, callback picker, Sales OS task, Google Calendar event.
6. **CRM check.** `dialer-crm-check` Edge Function: FUB match against synced contacts, Zoho COQL match. Wire into the upload summary.
7. **Ready to Push.** Queue UI, `dialer-crm-push` Edge Function for Zoho and FUB, Sales OS pipeline row for Bayway, failure Slack alert.
8. **Settings and polish.** Script and template editors, DNC manager, retry settings, archive lists.

## Acceptance criteria

- [ ] A 200-row CSV with nonstandard headers maps correctly after one confirm, and the first dial happens in under 2 minutes
- [ ] On iPhone Safari, Call opens the phone dialer with the right number, and the outcome screen is waiting on return
- [ ] No Zoho or FUB record is created by uploading, dialing, or logging any outcome. Only Approve in Ready to Push writes to a CRM.
- [ ] A number already in FUB or Zoho is flagged on upload and is not dialed unless the list toggle allows it
- [ ] A Do Not Call outcome blocks that number from every future upload, MPG and Bayway
- [ ] A no-answer lead returns after at least 4 hours, in the other half of the day, and goes `dead` after 3 misses
- [ ] A Cold Bayway lead outside the calling window cannot be dialed, and the reason is shown
- [ ] A Bayway approval creates a FUB person with source `CA Power Dialer` and `CA` tags, does not start the shared Lead Flow or any Action Plan, and lands in the right Sales OS stage
- [ ] An MPG approval creates a Zoho Lead with status Open and the call history as a note
- [ ] Callback requested creates the Sales OS task and Google Calendar event right away
- [ ] Dials and connects show up in the correct business's daily numbers the same day

## Build notes (Nov 20, 2026)

- Business ids are `mpg` / `bay`, column `business_id`, matching the rest of the schema.
- RLS is own-row (`user_id = auth.uid()`), the `mpg_touch_log` pattern; `tasks` is CRM-synced and read-only, so it is not the model. `dnc_numbers` is shared: everyone reads and adds, only the owner removes.
- Follow-up templates, retry settings and the hours guard live as columns on `dialer_scripts` (one row per user and business), keeping the table count at seven.
- Migration is `0072_power_dialer.sql`.
