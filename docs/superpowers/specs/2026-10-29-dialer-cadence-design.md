# Dial list and call cadences — design

Date: 2026-10-29. Status: approved design, not built.

## Goal

A visual "who to call today" list in the OS, with call cadences that move
people along by themselves: new leads get six attempts and then a short
nurture, and relationships (realtors, loans in process, past clients,
pre-approved buyers, top partners) each get their own weekday. Calls happen
on Chandler's cell phone or in FollowUpBoss; the OS has no phone line of its
own (no VoIP). The OS shows the list, opens the call or text, records the
outcome in the CRM and works out when each person is due next.

## Decisions (settled with the user)

- **Where:** the Workbench **Calls** tab becomes the dial list, plus a
  one-at-a-time **dialer** (focus mode). No new tab.
- **Calling:** tap to call on the phone (`tel:`) or open the lead in FUB. No VoIP.
- **Texting:** tap to text (`sms:` link with the number and a template filled
  in). On an iPhone it opens Messages and goes out as iMessage when the
  other person has it, SMS otherwise. Chandler presses Send; the OS can't send
  for him.
- **Lead cadence:** six attempts over eight days, then Nurture (weekly × 2),
  then Cold (monthly). Any real conversation exits the cadence.
- **Weekday themes:** Mon new realtors, Tue loan status updates, Wed past
  clients, Thu pre-approved clients, Fri top referral partners.
- **Top partners:** FUB tag `Top Partner` (created).
- **Agents on a loan:** stored in FUB **Relationships** on the borrower, type
  "Buyer's Agent" / "Seller's Agent". The Tuesday row shows the borrower, then
  the buyer's agent, then the seller's agent, each callable.

## The daily list

The Calls tab shows, top to bottom:

1. **They reached out**: Up Next's existing top bucket (unchanged).
2. **Lead cadence**: new and nurture leads due now (below). Every day.
3. **Follow-ups due**: Up Next's overdue / due-today follow-up tasks (unchanged).
4. **Today's theme**: the weekday list (below), capped (default 15).
5. **More**: the rest of today's Up Next buckets (hot going cold, no next
   step, stuck, gone quiet), collapsed.

Above the list: a Mon–Fri strip naming each day's theme with its count (today
highlighted; tapping another day previews that list), a "N of M calls today"
progress bar, and **Start dialing**.

Weekends: no theme list; the lead cadence, reached-out and follow-ups still
show (new leads still arrive). Cadence due dates that land on Saturday or
Sunday move to Monday, except attempts 1 and 2 (same day as the lead).

Mockup: the "Workbench dial list" and "Lead call cadence" visuals in the
2026-10-29 conversation that produced this spec.

## Lead cadence (Bayway, phase 1)

Who: Bayway leads in **New Lead** or **Attempted** (bay-stages.ts / v_active_pipeline).
Moving past Attempted (Contacted/Working or later) or to Lost ends it.

Attempt *n* is the *n*-th outbound call to the lead since it was created
(`activities`, type `call`, direction `outbound`), counting calls logged from
the OS *and* calls made in FUB, so the cadence can't drift from what really
happened. Logging a call from the OS writes the activity row at once
(crm-action), so the list updates immediately.

| Attempt | Due | With it |
|---|---|---|
| 1 | as soon as the lead arrives (speed to lead, 5 min) | text 1 if no answer |
| 2 | 3 hours after attempt 1, same day | |
| 3 | next business day, opposite half of the day to attempt 1 | text 2 if no answer |
| 4 | 3 days after attempt 1 | |
| 5 | 5 days after attempt 1 | text 3 / email |
| 6 | 8 days after attempt 1, the "closing the loop" call | text 4 |

- "Opposite half of the day": attempt 1 before noon, so attempt 3 is due from
  2 PM, and vice versa. The row shows "try afternoon" / "try morning".
- Attempts made early or late don't break anything: the next one is always
  measured from attempt 1, and an overdue attempt shows as due now.
- After attempt 6 with no conversation, the dialer's outcome step offers
  **Move to Nurture** (preselected) and the row shows "6 attempts, move to
  Nurture" until done. The OS never re-tags a lead in FUB on its own.
- **Connected** (Interested / Not Interested on the OS log, or the lead moving
  to Contacted/Working) ends the cadence; the existing Log call form takes it
  from there (next step, follow-up task).
- **Bad number** offers Move to Nurture or Lost.

### Nurture and Cold

Who: Bayway leads in the Nurture / Credit Repair column tagged **Nurture**.

- Nurture call 1 due 7 days after the lead entered the column (`stage_since`),
  call 2 seven days after call 1.
- After nurture call 2, the lead is **Cold**: off the daily list, with one
  check-in due every 30 days after its last outbound call (shown in the lead
  cadence block as "Cold check-in").
- Any inbound call/text puts the lead in "They reached out" as today.
- Credit Repair-tagged leads: monthly check-in (open question below).

## Weekday themes (Bayway)

Each list holds the people of that kind who are **due** (by their own rhythm
below) on or before today, most overdue first, capped. Someone not reached
stays due and comes back on the same weekday next week.

| Day | List | Who | Rhythm per person |
|---|---|---|---|
| Mon | New realtors | FUB stage Realtors, added in the last 90 days | calls in week 1, week 2, week 4, then monthly |
| Mon | Realtor check-ins | other Realtors (not Top Partner) | every 60 days (below new realtors) |
| Tue | Loan status updates | Disclosed column, plus any lead tagged `under contract` | every Tuesday until it leaves the stage |
| Wed | Past clients | FUB stage Closed / Past Client | every 90 days, plus the week of their home anniversary |
| Thu | Pre-approved | tagged `Pre-Approved`, still on the board (not Disclosed, parked or Lost) | weekly; flagged at 60+ days pre-approved so the letter gets refreshed |
| Fri | Top partners | tagged `Top Partner` | every 14 days (about half the list each Friday) |

- "Due" = days since the last outbound call to that person ≥ the interval.
  Never called counts as due.
- Past-client anniversary: the close date of their FUB deal (`deals`); with no
  deal, only the 90-day rhythm applies.
- Pre-approved age: when the OS tagged Pre-Approved (`crm_actions`), else the
  date the lead entered Application Received.

### Tuesday: borrower and agents

Each loan row lists up to three numbers: **borrower**, **buyer's agent**,
**seller's agent**, each with call and text.

- Agents come from the borrower's FUB Relationships (type matched loosely:
  "Buyer's Agent", "Buyer Agent", "Buyers Agent"; "Seller's Agent",
  "Listing Agent", "Seller Agent").
- An agent whose phone or email matches one of Chandler's Realtors in the OS
  is linked to that contact: the name opens their contact card, and a call to
  them counts toward their Monday / Friday rhythm.
- Unmatched agents show name and number only; calls to them are logged as a
  note on the borrower ("Called buyer's agent Jane Smith: left voicemail").
- A loan with no agents recorded shows "Add agents in FUB".
- The Tuesday row is done when the borrower has been called that week.

## The dialer (focus mode)

**Start dialing** walks the list in order, one person at a time:

- Name, book and stage, source, attempt pips (●●○○○○) or theme reason, the
  lead form facts and last note, the number in large type.
- **Call on phone** (`tel:`), **Open FUB**, **Text** (`sms:` with the
  template for this step).
- Outcome buttons: **No answer**, **Left voicemail**, **Connected**, **Bad number**.
  - No answer / Left voicemail: crm-action `log_call` (`No Answer` /
    `Left Message`, 1 min), with the New Lead → Attempted move the Log call form
    already makes, then shows when the next attempt is due and offers the text.
  - Connected: opens the existing Log call form (outcome, note, next step).
  - Bad number: `log_call` `Bad Number`, then offers Nurture / Lost.
- **Skip** (to the end of today's list) and **Not today** (off the list until
  tomorrow).
- Next person after each outcome. Ends with a summary: calls, connects, texts.

On a phone the dialer is a full-screen card with large buttons; on desktop
it sits beside the list.

### Texts

- Templates per lead-cadence step (texts 1–4) and per theme (Tuesday status
  check-in, Thursday pre-approval check-in, Friday partner check-in), with
  `{first_name}` filled in. In code for v1.
- Tapping Text logs a FUB note "Texted (template name)" through crm-action
  `add_note`, with Undo on the toast for when Send wasn't pressed.

## Data

- **v_dial_contacts** (new view, Bayway): every contact with its FUB person
  stage, tags, board stage (`derive_stage`), `stage_since`, `crm_created_at`,
  phone, email, outbound call count since created, first / last outbound call,
  last inbound activity, `top_partner` / `pre_approved` / `under_contract`
  flags, and the newest FUB deal close date. One read feeds the whole list;
  cadence rules run in the browser (pure `dialList.js`), like Up Next.
- **contact_relationships** (new table, mirror of FUB Relationships):
  `contact_id`, FUB relationship id, type, name, phone, email,
  `matched_contact_id`, `synced_at`. Filled by a new read-only crm-action
  action `contact_relationships` (FUB `GET /peopleRelationships?personId=`)
  for the Tuesday leads when that list loads (at most once an hour per lead),
  so the regular FUB sync isn't slowed down. Read-only to the app.
- **dial_skips** (new table, app-owned, per user, RLS): `contact_id`, `list`,
  `until_date` for "Not today".
- **settings.dial_cadence**: intervals and the theme cap, defaulting to the
  values above, so they can be tuned without a deploy.

No changes to how the OS writes to the CRM: every write is an existing
crm-action action (`log_call`, `add_note`, `set_stage`).

## Phases

1. **Lead cadence + dialer + texts** (Bayway): v_dial_contacts, dialList.js
   lead rules, Calls tab sections, dialer, sms templates, dial_skips.
2. **Weekday themes** Mon / Wed / Thu / Fri: theme rules, week strip, cap,
   settings.dial_cadence.
3. **Tuesday loan status with agents**: contact_relationships, crm-action
   `contact_relationships`, agent matching, three-number rows.

Each phase ships on its own PR with its migration and tests.

## Testing

- `dialList.test.js` (pure): attempt numbering from call history, due times
  (3 h, opposite half-day, business-day roll), cadence exit on connect / stage
  move, attempt-6 Nurture prompt, nurture 7/7 then cold 30, each theme's
  membership and rhythm, anniversary week, cap and ordering, skips.
- Render tests: Calls tab sections and week strip; dialer outcome → the right
  crm-action request; `sms:` / `tel:` links; Tuesday three-number row.
- crm-action: `contact_relationships` mapping and type matching.
- Browser: walk a day's list on a phone-sized screen with live data (no
  outcomes sent for real leads during testing unless Chandler is calling).

## Open questions (decide before the phase that needs them)

- MPG (Zoho) new leads: same six-attempt cadence? MPG has no Attempted stage,
  so attempts would be tracked from calls only. (Phase 1.)
- Credit Repair-tagged leads: monthly check-in, or off the dial list? (Phase 1.)
- Regular (non-new, non-top) realtors: every 60 days on Monday, as above? (Phase 2.)
- Past clients' close date when there's no FUB deal: skip anniversaries, or
  read a FUB custom field? (Phase 2.)
- Text template wording. (Phase 1.)

## Out of scope

VoIP / in-app calling and call recording; sending texts from the OS; MPG
weekday themes; editing FUB Relationships from the OS (add them in FUB).
