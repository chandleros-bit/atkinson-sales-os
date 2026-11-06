# MPG touch log, prospect lists and daily tracker export: Design

**Date:** 2026-11-05
**Status:** Slice 1 built on `feat/mpg-tracker-visits`, not deployed. The rest is not built.
**Decided with Chandler:** 2026-11-05 (Claude Code session reviewing `MPG_Chandler_Private_Tracker.xlsx`).
**Set aside (not in this spec):** writing to the spreadsheet automatically (Microsoft Graph). Chandler does not want a Microsoft sign-in; the sheet is filled by copy-paste. Deriving the Reports sprint numbers (statements received, proposals sent) from the touch log is a natural follow-on, not part of this spec.

## Problem

MPG management wants a daily tracker filled in: an Excel workbook (`MPG_Chandler_Private_Tracker.xlsx`) kept in Chandler's OneDrive and shared with the manager. Manual entry has stalled: the last visit row is Oct 3, the last ISV row Oct 5, and Follow-ups is empty.

The OS can't fill it today because it doesn't record most of what the sheet asks for. Walk-ins, per-touch outcomes, prospecting email, social outreach, ISV partners and cold-call counts exist nowhere in the OS or in Zoho. Of the 25 businesses on the Visits tab, only one (NJR Salons) is in Zoho.

## Goals

1. Record every MPG touch in the OS, quickly enough to do at the door on a phone.
2. Keep Zoho clean: only businesses that show interest become Zoho leads.
3. Produce each day's spreadsheet rows in the sheet's exact column order, ready to paste.

## Decisions

| Topic | Rule |
|---|---|
| Walk-in visits | Always logged in the OS and exported to the Visits tab. Not sent to Zoho unless promoted. |
| Visit promotion | The "Add to Zoho as Open" toggle defaults **on** when the visit is Hot or Warm, or has any outcome checked. It defaults **off** for Cold with no outcomes. Statement received, demo/proposal, application or boarded **forces** it on. |
| Cold calls | Every dial to a prospect not in Zoho counts toward a goal of **60 per day**, redials included. Exported as a daily count, not one row per dial. |
| Cold-call promotion | Only when a **decision maker answered** and the call is rated **Hot or Warm**. This happens automatically, with no toggle. Statement or later also forces promotion. Cold, no answer, voicemail and gatekeeper calls never promote. |
| Follow-ups | Calls and emails to businesses already in Zoho count as Follow-ups on the sheet. They do not count toward the 60. |
| Repeat visits | A walk-in always goes on the Visits tab, even when the business is already in Zoho. If it is in Zoho, the visit is also written there as a note. |
| ISV partners | Kept in the OS and on the sheet until their stage reaches **Proposal**, then promoted to Zoho. |
| Promoted lead | A Zoho **Lead** with `Lead_Status = 'Open'` and `Lead_Source = 'Chandler'`. Never "Initial lead": the OS hides that status (migration 0044). |
| Call lists | Built outside Zoho (Google Maps exports and other sources) and imported into the OS as prospect lists. |
| Sheet connection | Copy-paste from an OS export panel into the workbook in Excel desktop. The file stays in the synced OneDrive folder so the manager's shared view updates through AutoSave. |

## The spreadsheet (fixed; the manager owns it)

Every tab is password-protected and the workbook structure is locked. Only the yellow entry cells (unlocked) can be edited. There are no Excel tables. Setup says the manager keeps "all three files" (three reps) consistent, so the OS adapts to the sheet, not the other way round. Entry rows start at row 8.

| Tab | Entry columns (A → last) |
|---|---|
| Chandler Visits (A–M) | Visit date · Business · Contact / role · Phone / email · Meeting notes / pain points · Next step · Follow-up date · Prospect quality (Hot/Warm/Cold) · Decision-maker conversation? · Statement received? · Demo / proposal? · Application submitted? · Merchant boarded? |
| Chandler Follow-ups (A–L) | Completed date · Business · Activity type (Follow-up / Prospecting email / Social outreach) · Contact / channel · Notes / outcome · Next step · Next follow-up · Decision-maker conversation? · Statement received? · Demo / proposal? · Application submitted? · Merchant boarded? |
| Chandler ISV (A–I) | Outreach date · Company · Contact · Email / phone · Software / platform · Stage after touch (New prospect / Contacted / Discovery / Technical review / Proposal / Agreement / Live / Not a fit) · Notes / progress · Next step · Next follow-up |

The Points and Entry status columns are formulas. The export never fills them.

## What exists today that this builds on

| Fact | Where |
|---|---|
| App-owned, per-user tables with own-row RLS (`user_id default auth.uid()`). | `work_items` (0041), `contact_events` (0045) |
| CRM writes go through `crm-action` and are logged in `crm_actions`, with per-step results and a retry path for a single failed step. | 0028, `src/lib/crmActions.js` (`buildActionRequest`, `retryRequestFor`) |
| MPG write-back is live: OS-logged calls appear in Zoho as `Call: <outcome>` from Oct 20. | Zoho Calls |
| `buildZohoLead` creates MPG leads, but hard-codes `Lead_Status = 'Not Contacted'`. | `_shared/zoho-write.ts` |
| Zoho Lead_Status values seen: `Initial lead` (hidden from the OS), `Open`, `Pending`. Lead_Source `Chandler` is in use. | Zoho, docs |
| Lead temperature (Hot/Warm/Cold) is planned as the `lead_ratings` table. | `2026-11-03-temperature-forecast-briefings-design.md` |
| The dialer works over `v_dial_contacts`, which only covers synced CRM contacts. | 0049 |

## Data model

Three new app-owned, per-user tables (same RLS and `updated_at` trigger pattern as `work_items`). Insert and update policies on `mpg_prospects` and `mpg_touches` also check that the parent rows are yours or MPG's: a prospect's list must be your own, and a touch's prospect must be your own and its contact must be an MPG contact you can read. Foreign-key checks bypass RLS, so the plain own-row policy would not stop a row pointing at someone else's data.

### `mpg_prospect_lists`

One row per import: `id`, `user_id`, `name` (e.g. "Google Maps – Heights salons"), `source` (free text), `imported_at`, `row_count`.

### `mpg_prospects`

Businesses the OS knows about that are not (yet) Zoho leads. Walk-in businesses, cold-call list rows and ISV partners all live here.

```sql
create table mpg_prospects (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  kind           text not null default 'merchant' check (kind in ('merchant', 'isv')),
  list_id        uuid references mpg_prospect_lists(id) on delete set null, -- null = added at the door
  business_name  text not null check (nullif(trim(business_name), '') is not null),
  contact_name   text,
  contact_role   text,
  phone          text,
  phone_key      text,            -- last 10 digits, for dedupe
  email          text,
  address        text,
  category       text,            -- from the list (e.g. "Hair salon")
  platform       text,            -- ISV: software / platform
  isv_stage      text check (isv_stage in ('new_prospect','contacted','discovery','technical_review',
                                           'proposal','agreement','live','not_a_fit')),
  temperature    text check (temperature in ('hot', 'warm', 'cold')),
  status         text not null default 'new'
                 check (status in ('new', 'working', 'cold', 'bad_number', 'promoted')),
  zoho_lead_id   text,            -- set on promotion; joins to contacts.external_id once synced
  promoted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on mpg_prospects (user_id, phone_key);
create index on mpg_prospects (user_id, list_id, status);
```

`status`: `new` = never dialed or visited; `working` = touched, not yet reached or still undecided; `cold` = reached and Cold (kept, so a later visit can warm it); `bad_number`; `promoted` = now a Zoho lead (shown with a Zoho link, and no longer in the prospect dialer).

### `mpg_touches`

One row per touch. This is the only table the export reads.

```sql
create table mpg_touches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  occurred_at     timestamptz not null default now(),
  channel         text not null check (channel in
                  ('walk_in', 'cold_call', 'follow_up_call', 'email', 'social', 'isv')),
  prospect_id     uuid references mpg_prospects(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  -- Snapshots, so an exported row reads the same as when it was logged.
  business_name   text not null check (nullif(trim(business_name), '') is not null),
  contact_label   text,           -- "Jimmy / Manager"
  reach_label     text,           -- "832-474-7707" or "jimmy@njr.com"
  notes           text,
  next_step       text,
  follow_up_on    date,
  temperature     text check (temperature in ('hot', 'warm', 'cold')),
  call_result     text check (call_result in ('no_answer','voicemail','gatekeeper','dm_reached','bad_number')),
  dm_conversation boolean not null default false,
  statement       boolean not null default false,
  demo_proposal   boolean not null default false,
  application     boolean not null default false,
  boarded         boolean not null default false,
  isv_stage       text,           -- ISV: stage after this touch
  crm_action_id   uuid references crm_actions(id) on delete set null, -- the Zoho write this touch caused, if any (not filled in slice 1)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()  -- maintained by a before-update trigger
);
create index on mpg_touches (user_id, channel, occurred_at);
create index on mpg_touches (prospect_id) where prospect_id is not null;
create index on mpg_touches (contact_id) where contact_id is not null;
```

There is no `mpg_touches_has_subject` constraint: a touch whose prospect or contact is later deleted keeps its snapshot text, so "has a prospect or a contact" is checked in the app (`saveVisit`) when the touch is created, not in the database.

The tracker date of a touch is the **local calendar day** of `occurred_at` (America/Chicago), computed in the browser with the existing `dayKey`.

## Capture

All forms must work at 375 px wide. A walk-in is logged standing at the door.

### Log visit

Opened from **+ New → Log visit…** (shown on every view except Bayway, and never for the assistant), from a prospect, or from an MPG contact card.

- **Business:** search across MPG contacts and prospects (by business or contact name; phone search is deferred), or type a new one, which creates a prospect with `list_id = null`.
- **Fields:** contact name, role, phone/email, notes, next step, follow-up date, Hot / Warm / Cold (optional), and five outcome checkboxes (decision-maker conversation, statement received, demo/proposal, application submitted, merchant boarded).
- **Zoho toggle (slice 2):** "Add to Zoho as Open" follows the promotion rule above and updates live as the fields change. It is hidden when the business is already in Zoho.
- **On save:**
  - Always insert an `mpg_touches` row (`channel = 'walk_in'`).
  - **Prospect + toggle on:** run promotion (below).
  - **Business already in Zoho:** `crm-action` `add_note` writes a note on the lead with subject "Walk-in" and body "Walk-in · <Temp> · <outcomes> — <notes>".
  - **Follow-up date set on a Zoho lead:** also create the Zoho task, as Log call already does.

### Cold-call dialer (prospect mode)

The Workbench dialer gains a **Prospects** source: pick a list, then walk its `new` and `working` rows, oldest touch first, with tap-to-call (`tel:`). After each dial, one tap records the result: No answer · Voicemail · Gatekeeper · Bad number · **Reached decision maker**.

- **Every result** inserts an `mpg_touches` row (`channel = 'cold_call'`), and every one counts toward the 60. `bad_number` sets the prospect's status to `bad_number`; the others set `new` → `working`.
- **Reached decision maker** opens the rating step: Hot / Warm / Cold, notes, next step, follow-up date and the outcome checkboxes (decision-maker conversation is pre-checked).
  - **Hot or Warm, or statement or later checked:** promote automatically.
  - **Cold:** the prospect's status becomes `cold`.
- "Not today" skips a row for the day (same idea as `dial_skips`).
- **Progress:** a counter shows today's dials, e.g. "41 / 60".

### Follow-ups (businesses already in Zoho)

- **MPG Log call** gains the same five outcome checkboxes. Its `crm-action` request carries an optional `mpg_touch` block. After the Zoho call is written, the function inserts the `mpg_touches` row (`channel = 'follow_up_call'`) as a new `touch` step, so a failed insert retries through `retryRequestFor` like any other step.
- **New "Log touch" action** (MPG) records **Email** or **Social** (channel `email` / `social`) on a contact or a prospect: notes, next step, follow-up date and outcomes. If the business is in Zoho, it also writes a Zoho note ("Email: …" / "Social: …").

### ISV partners

- Prospects with `kind = 'isv'`. They are added by hand, or imported from a list marked ISV.
- **Log ISV touch:** contact, email/phone, platform, stage after this touch, notes, next step and follow-up date. It inserts an `mpg_touches` row (`channel = 'isv'`) and updates `isv_stage` on the prospect.
- When the stage reaches **Proposal** or later (Proposal, Agreement, Live), the touch promotes the partner (below). A Zoho note records "ISV partner – <platform>".

## Promotion to Zoho

This is a new `crm-action` action, `promote_prospect`. It is idempotent per `client_action_id` and logged in `crm_actions` like the others.

1. **Duplicate check.** A prospect with `zoho_lead_id` already set (an Initial-lead match from import) skips the search, has its status set to `Open`, and goes to step 3. Otherwise, search Zoho Leads by phone (last 10 digits), then by exact company name.
   - **Match found:** link to that lead and skip creation. If its status is `Initial lead`, set it to `Open`.
   - **Several matches:** the action returns `refused` with the candidates. The UI asks which one to link, or whether to create a new lead anyway.
2. **Create the lead.** Use `buildZohoLead` with a new `status` parameter set to `'Open'` (the default stays `'Not Contacted'` for New lead), plus `Lead_Source = 'Chandler'`. Name, company, phone and email come from the prospect, and `Description` holds role and address.
3. **Add a note** with the promoting touch's notes and outcomes.
4. **Create a task** for the follow-up date, if one is set.
5. **Mirror in the OS:**
   - Set `zoho_lead_id`, `status = 'promoted'` and `promoted_at` on the prospect.
   - Set `crm_action_id` on the touch.
   - The next `zoho-sync` brings the lead into `contacts`. Until then, the prospect row links to Zoho through `zoho_lead_id`.
6. **Carry the temperature.** If `lead_ratings` exists by then (temperature spec), write the rating for the synced contact. Until the contact syncs, keep it on the prospect.

**If promotion fails:** the touch and the prospect are already saved, so nothing is lost and the export is unaffected. The prospect shows "Not in Zoho yet · Retry", using the existing partial-failure pattern.

## Prospect list import

**Upload.** On a new **Prospects** page (MPG), Chandler uploads a CSV or pastes rows.

**Column mapping.** A mapping step guesses the columns from the headers (name/title, phone, address, category/type, website, email). Chandler confirms the guesses, names the list, and marks it Merchant or ISV.

**Duplicate check before saving.** Each row is checked by `phone_key`, then by name + address (normalized):
- **Matches an MPG contact in the OS** (any status other than Initial lead): skipped, because it is already in the pipeline and calls to it are follow-ups.
- **Matches a Zoho Initial-lead record** (checked against Zoho at import time, since `contacts` doesn't hold them): imported as a prospect with `zoho_lead_id` pre-filled. It is dialed like any prospect. Promotion then just sets that lead's status to `Open` instead of creating a new one.
- **Matches an existing prospect:** skipped.

**Summary.** For example: "212 new · 6 linked to Initial leads · 18 already in pipeline · 9 already on a list".

The Prospects page lists prospects by list and status, with search. From a prospect, Chandler can log a visit, call, edit or delete it.

## Daily tracker export

This is a new **Daily tracker** tab on Reports, visible on the MPG view.

- **Date picker.** Defaults to today.
- **Visits block:** every `walk_in` touch that day, in Visits column order A–M.
- **Follow-ups block:**
  - `follow_up_call` → Activity type "Follow-up",
  - `email` → "Prospecting email" when the subject is a prospect and "Follow-up" when it is a Zoho contact,
  - `social` → "Social outreach".
  - The "Contact / channel" column reads `<contact label> · Phone`, `· Email` or `· Social`.
- **ISV block:** `isv` touches in ISV column order A–I. Stage is written with the sheet's labels (e.g. "Technical review").
- **Cold calls line:** "Cold calls: 62 dials · 9 decision makers · 3 promoted", with its own Copy button.
- **Copy buttons.** Each block has one, which copies tab-separated rows with no header. Chandler clicks the first empty yellow cell in column A of the matching tab and pastes.
- **Formatting rules (pure, unit-tested):**
  - **Dates:** `M/D/YYYY`, which the sheet's date validation accepts.
  - **Flags:** `Yes` / `No`, matching the sheet's list validation. No flag is ever left blank, so every row is complete.
  - **Quality:** `Hot` / `Warm` / `Cold`, or blank.
  - **Tabs and line breaks** in text become ` · ` so a note can't split into extra cells.
  - **Text starting with** `=`, `+`, `-` or `@` gets a leading space so Excel never reads it as a formula. This matters for phone numbers like `+1…`.
- **Already copied.** The panel remembers in localStorage when each block was copied for each date. It warns "Copied 6:12 PM · 2 rows logged since" when touches for that date were created after the copy (a backdated entry, say). "Copied <time>" is the click time; "new since copy" compares against the server `created_at` of the newest copied row, so it never depends on the browser clock, and offers **Copy new rows only**.
- **Rows are read-only here.** To fix one, Chandler edits the touch, which opens from the row, and copies again. Fixing a row already pasted into the sheet is done in the sheet by hand.

## Asks for the manager (sheet changes the OS can't make)

1. **Cold calls.** Add a place for the daily cold-call count (a Metrics row or a small tab), with a goal of 60 a day and its points weight.
2. **Decision-maker conversations from cold calls.** Should they count toward the existing metric? Today that metric reads only Visits and Follow-ups. If yes, the cold-call line needs a matching cell on the sheet.

Until the manager changes the sheet, the cold-call line is copied into whatever cell the manager designates, or sent with the daily report.

## Error handling

- **Capture never waits on Zoho.** The touch row saves first. Zoho writes (promotion, note, task) run afterwards, and their failures appear on the prospect or contact with Retry.
- **Slice 1:** a Zoho failure shows an error toast with Retry, which resends only the failed write. `crm_action_id` isn't filled in yet.
- **The export reads only `mpg_touches`,** so Zoho or sync outages can't change what is exported.
- **Promotion is idempotent** (`client_action_id`). A double tap can't create two leads.
- **Imports are all or nothing per file:** a parse error rejects the file and names the bad row.

## Testing

- **Pure helpers** in `src/lib/mpgTracker.js` (unit tests, vitest):
  - row builders for each tab,
  - TSV escaping and formula guarding,
  - the date format,
  - the promotion rules (visit toggle default and force, cold-call auto-promote, ISV stage threshold),
  - `phone_key` normalization,
  - header guessing for the CSV mapping,
  - "Copy new rows only" selection.
- **Edge function:** `promote_prospect` plan tests, following `crm-action/plan.test.js`. Cover no match, one match with Initial lead (status set to Open), several matches (refused), and a failed note step retried.
- **Render tests:** Log visit (the toggle follows the rules; hidden for Zoho contacts; the toggle and its test are slice 2), the dialer's prospect mode (result taps, 60 counter) and the Daily tracker panel (blocks, copy states).
- **Manual check before launch:** paste one day's blocks into a copy of the real workbook. Confirm every row reads "Counted" and the points calculate.

## Build order

Each slice ships on its own and is useful by itself.

1. **Touch log + Log visit + Daily tracker (Visits block).** This replaces typing the Visits tab.
2. **Promotion to Zoho** (`promote_prospect`, `buildZohoLead` status parameter, duplicate check).
3. **Follow-ups:** outcome checkboxes on MPG Log call, the `touch` step, Log touch for email/social, and the Follow-ups block.
4. **Prospect lists + dialer prospect mode + the cold-calls line.**
5. **ISV:** ISV prospects, Log ISV touch, Proposal-stage promotion and the ISV block.
6. **Optional backfill:** import the 25 visit rows and 31 ISV rows already on the sheet, so repeat visits link to their history.

## Verify before build

- **Duplicate search:** the Zoho Leads search endpoint (`/Leads/search` with `phone` / `criteria`) and its rate limits.
- **Lead_Status picklist:** confirm `Open` is a valid value on the Leads layout used for new leads.
- **Lead_Source picklist:** confirm `Chandler` is a picklist value, not just a stored legacy value.
- **ISV field in Zoho:** check whether MPG Zoho has a partner/vendor module or a lead field for ISV partners. If not, the note text is the only marker.
- **Write-back flag:** confirm `writeback_enabled.mpg` is `true` in production. Calls from Oct 20 suggest it is; the migration default is `false`.
