# Lead temperature, production forecast and daily briefings: Design

**Date:** 2026-11-03
**Status:** Sections 1-2 built on feat/lead-temperature (not deployed). Section 3 not built.
**Decided with Chandler:** 2026-11-03 (discussion in the Claude Code session that shipped PRs #80–#82).
**Set aside (not in this spec):** FUB email template editor, adding leads to FUB action plans from the OS, Brevo blast emails, OS-owned drips. FUB's API can list action plans, apply them to a person and pause or resume them, and create or edit email templates; it cannot create or edit action plans or send email (it only logs email-marketing events via `/emCampaigns` and `/emEvents`).

## Scope

Three pieces, built in this order:

1. **Lead temperature** (Hot / Warm / Cold) set by Chandler after a real conversation, kept beside the existing nightly score.
2. **Production forecast**: expected payout for this month and next, plus a "pays first" sort.
3. **Daily briefings** by email: one for Chandler (both books), one for his Bayway assistant, who gets her own Bayway-only login.

## What the data holds today

| Fact | Where |
|---|---|
| Nightly Bayway score 0–100 and tier `hot` / `warm` / `active` / `never_contacted`, built from logged activity volume and recency. Any FUB tag `hot` forces tier `hot`. | `score-fub-leads`, `_shared/scoring.ts` (`isHotTag`, `assignTier`) |
| `is_hot` in Up Next = tier `hot` or a FUB `hot` tag (Bayway); `person_stage` in `mpg_hot_statuses` (MPG, empty list today). | `v_lead_signals` (0029 and later) |
| MPG has no score. | — |
| Bayway commission: `estComp(loan, rates)` = `comp_override`, else amount × `primary_pct` (1.25) or `assisted_pct` (0.75). Rates live in settings key `arive`. | `src/lib/loans.js` |
| Arive loans: `amount`, `role`, `stage_group` (`prospect`, `processing`, `closing`, `funded`, `adverse`, `other`), `funded_on`, `firm_closing_on`, `title_company`, buyer/seller agent fields, `contact_id`. | `loans` (0052) |
| MPG average residual per account = manual monthly residual ÷ manual active merchants. | `src/lib/reports.js` `rev_avg_residual` |
| Every data table has `authenticated read … using (true)`: any signed-in user reads everything. `work_items`, `lead_snoozes` are per-user. | migrations |
| CRM writes go through `crm-action`, logged in `crm_actions` with `user_id`. Actions: `log_call`, `add_note`, `create_task`, `complete_task`, `push_task`, `set_stage`, `create_contact`. | 0028, `src/lib/crmActions.js` |
| Meetings: `calendar_events` (Outlook ICS sync). | `outlook-sync` |
| Call cadence, Up Next, alerts, card health are pure JS in `src/lib` (`dialList.js`, `priorityQueue.js`, `alerts.js`, `cardHealth.js`). | — |

---

## 1. Lead temperature

### Two signals, not an override

- **Temperature** is Chandler's read of intent after a conversation. It is the primary ranking and the only forecast input for leads not yet in Arive.
- **Engagement** is the existing nightly score and tier, renamed in the UI (it measures how much a lead has been worked, not how serious they are). It breaks ties inside a temperature and ranks unrated leads, as today.
- MPG has no Engagement, so temperature is its only signal.

### Setting it

- **Log call:** when the outcome is a conversation (Interested or Not Interested), the form shows an optional one-tap row **Hot · Warm · Cold**. Next to Hot or Warm, an optional **Est. amount** field (loan amount for Bayway; MPG has none, see Forecast). Saving the call saves the rating.
- **Card and person sheet:** a temperature chip that opens the same three choices plus amount and close month.
- **Close month** defaults from the temperature: Hot = next month, Warm = two months out, Cold = three months out. Editable per lead.
- **Launch backfill:** a one-time **Rate leads** screen listing active leads with a connected call and no rating. Keyboard: H / W / C, Enter for next. Leads that already carry a FUB `hot` tag pre-select Hot.
- **No decay.** A rating stays until Chandler changes it. The existing **Hot, going cold** bucket (Hot with no touch in `hot_cold_days`, 3) now keys off temperature Hot when rated. New flag **Cold, but active**: rated Cold and the Engagement score rose by ≥ 20 since the rating (re-rating, even at the same temperature, re-snapshots the score and clears it). Shown on the card and the Person sheet.

### Storage

New OS-owned table (pattern of `work_items`, but shared, not per-user):

```sql
create table lead_ratings (
  contact_id   uuid primary key references contacts(id) on delete cascade,
  business_id  text not null references businesses(id),
  temperature  text not null check (temperature in ('hot', 'warm', 'cold')),
  est_amount   numeric,          -- Bayway only; null = use average funded loan
  close_month  date,             -- first of month; null = default from temperature
  rated_at     timestamptz not null default now(),
  rated_by     uuid not null,    -- auth.uid()
  score_at_rating numeric        -- for "Cold, but active"
);
```

RLS: the owner reads and writes; the assistant reads Bayway rows only (see section 3). `v_lead_signals` and the Pipeline row select join it (`temperature`, `est_amount`, `close_month`).

### CRM write

- **Bayway:** a new `crm-action` action `set_temperature` sets exactly one of the FUB tags `Hot`, `Warm`, `Cold` and removes the other two, so FUB smart lists and (later) action plans can use it. Logged in `crm_actions` like any write.
- **MPG:** OS only for now. Writing to Zoho needs a new custom field (later).

### Scoring changes

- `isHotTag` stops reading tags: the `hot` tag now belongs to temperature. Tier `hot` comes from the score alone.
- `is_hot` = temperature is Hot when the lead is rated, else Engagement tier `hot` (Bayway) or `mpg_hot_statuses` (MPG).
- UI labels: the tier shows as **Engagement: high / medium / active / none** inline (Person sheet) and as **High engagement / Medium engagement / Active / Never Contacted** on the Priority Leads tabs; never bare "Hot"/"Warm", so the words don't collide.

### Where it shows

- **Pipeline cards:** a Hot / Warm / Cold chip; a Temperature filter (All, Hot, Warm, Cold, Unrated).
- **Up Next and the call list:** within each bucket, Hot first, then Warm, then unrated by Engagement, then Cold.
- **Overview:** the forecast card (section 2).
- **Daily briefing:** Hot leads due a touch, and the forecast line.

---

## 2. Production forecast

### Formula

For each month M (this month and next):

```
expected(M) = Σ  payout(lead) × odds(lead)   over leads whose pay month is M
```

**Bayway, loan already in Arive** (`loans.contact_id` matches, or the loan has no contact): Arive wins and the rating is ignored.

- `payout = estComp(loan, rates)`.
- `odds` by `stage_group`: prospect **30%**, processing **75%**, closing **95%**, funded **100%** (already earned), adverse/other 0.
- Pay month = the month of `funded_on` if funded, else `firm_closing_on`, else the lead's close month, else excluded and listed as "no date".
- Bayway pays the **same month it funds**.

**Bayway, rated lead with no Arive loan:**

- `payout = (est_amount ?? average funded loan) × primary_pct / 100`. An average stands in until an amount is typed or Arive has the file, and is marked **est.**
- Average funded loan = mean `amount` of funded primary loans in the last 12 months (fallback: all funded loans).
- `odds`: Hot **60%**, Warm **30%**, Cold **10%**.
- Pay month = close month.

**MPG, rated lead:**

- `payout` = average residual per account (`rev_avg_residual`), else `forecast.mpg_est_residual_per_account` (marked **est.**). If both are blank, MPG shows **expected new accounts** (Σ odds) instead of dollars. No residuals have been received yet (2026-11-03), so this is the starting state.
- Same temperature odds and close month.
- The forecast counts the first month's residual only; it does not annualize.

**Unrated leads** count $0.

### Settings

New settings key `forecast`, editable on Settings:

```json
{
  "temp_odds":  { "hot": 60, "warm": 30, "cold": 10 },
  "arive_odds": { "prospect": 30, "processing": 75, "closing": 95 },
  "close_offset_months": { "hot": 1, "warm": 2, "cold": 3 }
}
```

### Overview card

**Forecast · This month / Next month**

- Expected payout per book and combined.
- A secondary line, "Funded so far $X · Weighted pipeline $Y", for this month.
- Count of leads marked **est.**
- Tap opens the list behind it.

### "Pays first" sort

A sort option on Pipeline and the forecast list: expected pay date ascending (funded/firm-closing date, else first day of the close month), then payout × odds descending. Unrated leads sort last.

### Pure module

`src/lib/forecast.js`: `leadPayout`, `leadOdds`, `payMonth`, `forecastByMonth(rows, loans, rates, settings, now)`, `paysFirst(rows, …)`. Fully unit-tested; no I/O.

---

## 3. Daily briefings

### Delivery

- **When:** Monday to Friday, **7:30 AM America/Chicago**. pg_cron runs in UTC, so schedule two jobs, `30 12 * * 1-5` and `30 13 * * 1-5`. The function sends only when the Chicago local time is 07:xx, and only once per recipient per date. That keeps it right across DST.
- **Sender:** **Gmail**, from `chandler.dashboard@gmail.com` (display name "Atkinson Sales OS"), authenticated with a Gmail **app password**.
  - Secrets: `GMAIL_USER` and `GMAIL_APP_PASSWORD`, which Chandler sets himself. The account needs 2-Step Verification on before Google offers app passwords.
  - No Resend account and no DNS changes. Gmail allows about 500 sends a day; this uses about 10 a week.
- **Recipients:** Chandler's briefing goes to `chandler@baywayhtx.com`, Shelby's to `shelby@baywayhtx.com`. Both work from day one.
- **SMTP port:** Supabase Edge Functions block outbound ports 25 and 587, so connect to `smtp.gmail.com:465` (implicit TLS). Confirm this early in the build. If 465 is also blocked, fall back to the Gmail API's `users.messages.send` with an OAuth refresh token.
- **First sends:** Microsoft 365 may file the first emails as Junk. Add `chandler.dashboard@gmail.com` to both mailboxes' safe senders.
- **Always sends**, even on a quiet day: "Nothing slipping today." A missing email means a broken job.
- **Health:** each send writes `sync_log` rows with source `briefing-owner` and `briefing-assistant`, status `ok`, `error` or `skipped`. Sync Status lists both (not part of the header's core sources).
- **Settings key `briefings`:** `{ "enabled": true, "owner_email": "chandler@baywayhtx.com", "assistant_email": "shelby@baywayhtx.com", "app_url": "https://atkinson-sales-os.vercel.app" }`.

### Edge function `daily-briefing`

Deno, deployed `--no-verify-jwt` for pg_cron, like the syncs.

1. Read data with the service role.
2. Build each briefing as data with pure builders: `buildOwnerBriefing(data, now)` and `buildAssistantBriefing(data, now)`.
3. Render HTML plus a plain-text version.
4. Send through Gmail SMTP.
5. Log to `sync_log`.

The builders reuse the logic behind Up Next, the call list, alerts and card health, so the email and the app always agree. **Implementation question for the plan:** the edge function needs those `src/lib` modules. Either import them across directories, if the Supabase bundler accepts that, or move the pure pieces into `supabase/functions/_shared` and re-export them from `src/lib`. `QuickActions` already imports `_shared/bay-stages.ts`, so that direction works today.

### Chandler's briefing (both books)

Subject: `Briefing · Tue Nov 3 · 4 to call first · $12.4k forecast`

Every list shows its **top 5 plus a total count and a link** to the matching OS view.

1. **Numbers**
   - Month to date against the Overview goals (`monthlyGoals`): Calls, Bayway Applications and Loans closed, MPG New merchant accounts and Proposals delivered. Gross commission and MPG residual are left out. Each shows hit / on pace / behind, and a goal that's behind adds "need N per business day".
   - This month's forecast, with funded so far vs weighted.
   - Yesterday's scorecard:
     - outbound calls
     - connects (`call_connected`)
     - new applications (moved to Application Received yesterday)
     - texts
2. **Today**
   - `calendar_events` for both books.
   - Closings this week (`firm_closing_on` within 7 days, open loans).
3. **Call first**
   1. They reached out: inbound since the last business day, no reply.
   2. New leads not yet called (speed to lead).
   3. Call cadence attempts due today, counted per book, from `buildDialList`.
   4. Overdue follow-ups.
   5. Hot leads with no touch in 3 days.
4. **Slipping**
   - Applications gone quiet.
   - Docs aging.
   - MPG statement tasks overdue.
   - Any core sync whose latest `sync_log` row is an error, or more than 45 minutes old.
   - Omitted when empty. "Nothing slipping today" when the whole section is empty.

### Assistant's briefing (Bayway only)

Subject: `Bayway files · Tue Nov 3 · 2 closing this week · 5 docs to chase`

1. **Closing in 7 days:** open loans with `firm_closing_on` in the next 7 days. Each shows:
   - borrower
   - closing date
   - outstanding docs
   - title company
   - buyer and seller agent with phone
2. **Missing docs:** borrowers with outstanding docs, oldest request first. Requests 7 or more days old are marked **Chase today**.
3. **New applications:** contacts that entered Application Received on the last business day. Set up the file and send the doc list.
4. **Disclosures due** (shown before Missing docs in the email): Application Received, not yet Disclosed. **Disclose by `<date>`**, which is 3 business days from `stage_since` under the TRID Loan Estimate rule, red when due or past.
5. **Waiting on borrower**
   - Application/Estimate Sent with no movement in 3 or more days.
   - Her own `work_items` check-backs that are due.

Each row carries the borrower's name, what's missing and a link into the OS. No income, SSN, credit or other sensitive loan data goes in the email. No forecast, commission or MPG content.

### The assistant's login

The bulk of the work in this section. The OS is single-user today.

- **Roles table:**
  ```sql
  create table user_roles (
    user_id uuid primary key,
    role    text not null check (role in ('owner', 'assistant')),
    books   text[] not null
  );
  ```
  Chandler is `owner` with `{bay,mpg}`. The assistant is `assistant` with `{bay}`. Helper `public.can_read_book(book text)`.
- **Account creation:** created by invite from the Supabase dashboard. Public sign-up stays off.
- **Read access:** every `authenticated read … using (true)` policy on a table with `business_id` becomes `using (public.can_read_book(business_id))`. Tables with no book become owner-only:
  - `sync_log`
  - settings keys other than display ones
  - `crm_actions` (other people's rows)
- **Money is hidden from her:**
  - The `loans` table becomes owner-only. She reads `v_loans_assistant`, which has no `comp_override` and no role split.
  - Settings keys `arive`, `forecast` and `priority_rules` are owner-only to write.
  - The forecast card and comp columns don't render for her.
- **Writes through `crm-action`:** the function reads the caller's role.
  - **Assistant may:** `add_note`, `complete_task`, `create_task` (follow-ups), only on Bayway contacts.
  - **Assistant may not:** `log_call`, `set_stage`, `set_temperature`, `create_contact`, `push_task`. These are refused, and the refusal is recorded.
  - Her writes reach FUB through Chandler's FUB API key, so in FUB they look like his. `crm_actions.user_id` records her, and the OS shows "by assistant" on the note or task.
- **Navigation for her:**
  - She sees Workbench (Bayway), Tasks (Bayway), Pipeline (Bayway, read-only board) and the Person sheet.
  - Hidden: Overview money cards, Reports, Loans comp, Settings and Sync Status.
  - Temperature chips are visible to her.

---

## Testing

- **Unit tests (Vitest):**
  - `forecast.js`: each payout path; odds; pay month; Arive beating the rating; average-loan fallback; MPG with no residual.
  - Ranking with temperature in `priorityQueue.js` and `dialList.js`.
  - `cardHealth.js`: the chip and "Cold, but active".
  - The scorer ignoring tags (`_shared/scoring.test.ts`).
  - Briefing builders against fixtures, including the empty "Nothing slipping" day.
  - The DST send-window check.
- **Render tests:**
  - The Log call temperature row appears only on a conversation outcome.
  - The rating screen works by keyboard.
  - The forecast card.
  - The Pipeline filter and "pays first" sort.
  - The assistant's role hides money and actions.
- **RLS tests:** SQL checks run as an assistant JWT. She reads Bayway, gets nothing for MPG, `loans` and `sync_log`, and `crm-action` refuses a forbidden action.
- **Manual:**
  - One live send of each briefing to Chandler.
  - One FUB tag write on the ZZ Test record.

## Build order

1. **Temperature + forecast.**
   - Migration: `lead_ratings`, settings key `forecast`, view joins.
   - `crm-action` `set_temperature`, with a FUB tag write tested on ZZ Test.
   - Scorer change.
   - UI: Log call, chips, Pipeline filter, Up Next ranking, rating screen, forecast card, "pays first".
2. **Chandler's briefing.** Gmail app password and secrets, the `daily-briefing` function, cron jobs, `sync_log` rows, settings key `briefings`.
3. **Assistant.**
   - `user_roles`, RLS rewrite, `v_loans_assistant`, `crm-action` role checks, nav gating.
   - The assistant's briefing.

Each step is its own PR. Steps 2 and 3 deploy edge functions and migrations, and each needs Chandler's OK before it touches production.

## Answers to the open questions (2026-11-03)

1. **Assistant:** Shelby Atkinson, `shelby@baywayhtx.com`. Invite her from the Supabase dashboard; set `briefings.assistant_email`.
2. **Sender:** changed from Resend to **Gmail** (`chandler.dashboard@gmail.com`, app password), delivering to `chandler@baywayhtx.com` and `shelby@baywayhtx.com`.
   - Resend can only send from a domain it has verified, and gmail.com can't be verified, so it was dropped.
   - No DNS work. For reference: `baywayhtx.com` DNS is on Cloudflare and company mail is Microsoft 365.
   - The domain carries a `brevo-code` verification TXT and sends DMARC reports to Brevo, but has no Brevo DKIM. That's worth checking for the set-aside blast work.
3. **"Disclosures pending"** (confirmed): the Arive import has no disclosure stage (App Intake, Qualification, Pre-Approved, Approved w/ Conditions, Clear To Close, Loan Funded/Finalized, Adverse). The FUB board does: Application Received, then Disclosed.
   - **Pending** = in Application Received and not yet moved to Disclosed.
   - TRID requires the Loan Estimate within 3 business days of the application, so the row shows **Disclose by `<date>`**, counting business days from `stage_since`.
   - The row is red on or after the due date. The assistant's briefing lists them under **Disclosures due**, ahead of Missing docs.
4. **Goals** (confirmed): the briefing uses the Overview's existing monthly goals (`monthlyGoals` in `overviewDash.js`), with the same hit / on pace / behind status.
   - **Both books:** Calls.
   - **Bayway:** Applications, Loans closed.
   - **MPG:** New merchant accounts, Proposals delivered.
   - Gross commission and MPG residual are left out of the briefing. The forecast line covers money.
   - Each goal that's behind also shows "need N per business day" for the rest of the month.
5. **MPG forecast with no residuals yet** (confirmed): the forecast shows MPG as **expected new accounts** (rated leads × odds), not dollars. A dollar figure appears when either:
   - Reports has a monthly residual and active-merchant count, or
   - an optional `forecast.mpg_est_residual_per_account` setting is filled in (marked **est.**).
