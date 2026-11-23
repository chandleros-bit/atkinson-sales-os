# Workbench v2: Design

**Date:** 2026-11-23
**Status:** Design approved with the decisions at the end (2026-11-23). Nothing built.
**Mockups:** [Workbench redesign](https://claude.ai/artifact/J74KrvWUpMUnQES4kPmCns) (six screens: desktop, phone, after the call, open file, assistant, end of day). Mockup names and numbers are samples.
**Builds on:** `2026-11-22-overview-workbench-redesign-design.md` (Part B is the contract this spec fills in), `2026-10-22-workbench-design.md`, `2026-10-29-dialer-cadence-design.md`, `2026-11-20-power-dialer-design.md`, `2026-11-05-docs-in-os-design.md`, `2026-11-03-temperature-forecast-briefings-design.md`.

---

## Problem

Workbench today is two lanes. Calls holds four boxes (the weekday theme, overdue follow-ups from Up Next, the lead cadence, and "More from Up Next"); Work holds the file groups. An alerts rail sits on top and two progress bars sit in the header.

- **No single "what next".** The calls are spread over four boxes in two orders, and the files are in a separate lane.
- **The order moves all day.** Every sync reshuffles the lists, so the plan you made at 8:00 isn't the plan at 11:00.
- **Hard deadlines aren't pinned.** A closing disclosure due tomorrow sits in a list like any other item.
- **No money on the page.** Nothing says which item is worth the most.
- **No end to the day.** Nothing records what rolled over or what tomorrow starts with.
- **Assistant view:** it's the Work lane with dollars stripped. It isn't a view built for her job.

Overview now owns the month and the whole book (PRs #129–#131). Workbench owns **today**.

## What Workbench v2 is

Three untimed work lists: **Calls**, **Files** and **Partners**. Their order is set each morning. One **Next up** card says what to do now, and **Hard dates** are pinned above everything. A small side panel holds the money and today's counts. You work the lists whenever the day allows; nothing has a set time.

---

## The page (desktop)

Top to bottom, main column on the left (about 2/3) and side panel on the right.

### 1. Header

- "Workbench", the date, and "order set at 8:00" (the time the day's order was set, see §4).
- On the right: Priority Leads, Voice task and **+ Work item**, as today.
- The book switch is the app's global one.
- The two progress bars leave the header for the side panel (§9).

### 2. New-lead banner

- Shows the newest uncalled lead under 30 minutes old, from `freshLead()` in `workLists.js`, the rule Overview already uses.
- Content: name, source, loan type, state and amount, read from the lead's first note with `noteFacts.js`.
- **Call now** opens the Dialer on that one lead.
- The banner never reorders the lists; it sits above them until the lead is called or turns 30 minutes old.

### 3. Hard dates

- Lists closing disclosures due and rate lock expiries within 14 days, overdue ones included. Source: `hardDates(loans, now)` in `bookFlags.js`, already built.
- Pinned above everything, whatever the dollars.
- Each row: when it's due ("Due Wed", "Dec 9"), the borrower, one plain line, and **Open**, which opens the person sheet on the Loan tab.
- Hidden when empty.

### 4. The day's order

The three lists are worked whatever order the day allows. The order **inside** each list is set once a day and holds until tomorrow (decision 1).

- **Set:** on the first Workbench load after 6:00 AM Central, the item keys of each list are saved in order.
- **Done or snoozed items** drop out of the day's order.
- **Items that arrive later** go to **New since 8:00**, and **Pull in** adds them to the end of their list. Three kinds are urgent enough to skip that strip:
  - new leads (they get the banner);
  - hard dates;
  - people who reached out.
- **Not done by day's end:** an item keeps its place and is pinned first in tomorrow's order.

### 5. Next up

The dark card in the mockup.

- **Which item:** the first open item of the list you're working. That's the list whose Start you pressed last; before any Start, it's Calls.
- **Header:** the list name, the book, the time estimate, and the item's value (§8).
- **Body:**
  - the name and one sentence on why it's next;
  - the file's chips: source, credit band, loan type, amount, city, and Arive stage with the lender;
  - the buyer's agent with their last update;
  - the last three touches;
  - open tasks and missing docs.
- **Actions:**
  - **Call**: a `tel:` link with `callAttrs`, so `PostCallHost` asks how it went.
  - **Call agent**, on loan files.
  - **Done**.
  - **Snooze**: "Not today" for calls (`dial_skips`); check back tomorrow for files (`work_items`).
- **Keyboard:** Shift+D done, Shift+S snooze, J next, Z undo (the last Done or Snooze this session).

### 6. The three lists

Each list is one card. `workLists()` in `src/lib/workLists.js` gives every list's `{ key, label, sub, count, flagged, items }`, which Overview's Your day tiles already show.

- **Header:** the name, the count and a rough time ("7 · ~50 min"), a one-line description, and the start button:
  - **Start dialer** for Calls and Partners (the existing `Dialer`, walking that list);
  - **Start first file** for Files (§11).
- **Row:** a tag (Close, App, Lead, MPG, Realtor), the name, the why, a flag chip when flagged, the due time or a time estimate, and the value (§8).

**What each list holds (decision 2 places the theme days):**

| List | Items, in order |
|---|---|
| **Calls** | 1. They reached out (Up Next `reached_out`). 2. Today's borrower theme: loan status on Tuesday, past clients on Wednesday, pre-approved on Thursday. 3. Follow-ups overdue (Up Next `overdue`). 4. The lead cadence due now: speed to lead first, then temperature (`buildDialList`). 5. Cadence calls due later today, by time. |
| **Files** | `buildWorkGroups` (estimates, applications, disclosed, statements, your own items), minus waiting. Order: items with a hard date, then flagged (`late`), then value, then age. |
| **Partners** | Today's realtor theme: new realtors on Monday, top partners on Friday (`buildThemeList`). Empty Tuesday to Thursday; the card then reads "No partner list today · {theme} is in Calls". |

Up Next's other buckets are hot going cold, no next step, stuck in stage, and gone quiet. They don't become list items; they live in the Slipping strip (§7, decision 3).

### 7. New since 8:00, Parked and Slipping

- **New since 8:00** is a dashed strip: how many items arrived since the order was set, their names, and **Pull in**. Hidden when there are none.
- **Parked** is a grey strip of counts by reason: waiting on lender or borrower (work items marked waiting), cold leads (the Bayway Parked stage), and your own notes. Each item returns on its check-back day, as it does today.
- **Slipping · N** is one collapsed strip under Parked. It replaces the alerts rail and the "More from Up Next" box.
  - Closed, it shows the total and the count per group: hot going cold, no next step, stuck in stage, gone quiet (Up Next's buckets, with the rules `alerts.js` uses today).
  - Opened, it lists the people by group, each name opening the person sheet, as the rail's tiles do now.
  - Pulling someone into today's lists is **Add to Calls**, which appends them like Pull in.
  - Hidden when nothing is slipping.

### 8. Value on each row

| Item | Value shown |
|---|---|
| A loan in Arive | Exact estimated commission (`estComp`) |
| A rated Bayway lead with no loan | A band from its forecast line, payout × odds: **$** under $1K, **$$** $1K–$3K, **$$$** over $3K |
| An MPG merchant | **$$** when there's a residual per account (`mpgPerAccount`), else "—" |
| Partners | "—" |

The assistant never sees values (§12).

### 9. Side panel

- **Gap card** (spec B5): "{Month} · Bayway, Gap to goal $X", where X = target − (funded + closing + leadsLow) from `forecastLayers`. It links to `/#forecast`. At zero or below it reads "Goal covered". Hidden in the MPG view.
- **At risk:** "N items flagged in today's lists" with the sum of their values. Exact for Arive loans; for rated leads, the weighted value.
- **Today's counts:** Calls, Files and Partners as done / list size. These replace the header progress bars. Calls still counts logged calls against the daily cap.
- A one-line note: "No set times: work the lists in whatever order the day allows."

### 10. Phone

As the Phone mockup, stacked in this order:

- the new-lead strip and the hard dates;
- the Next up card with Call, then three buttons: Agent, Done, Snooze;
- the three lists as rows (Calls has **Start dialer**; Files and Partners open their list);
- "New since 8:00 · N · Parked · N" as one line.

The book tabs and the Calls / Work lane tabs go away.

---

## 11. Open file (Files items)

The Open file mockup. A side sheet on desktop and a full screen on a phone, opened from a Files row or **Start first file**.

**Header:**
- the tag, the list, the book and a time estimate;
- the estimated commission (owner only);
- the name and the task ("review application");
- chips: the stage with its age, the loan type and amount, the credit band, the realtor;
- **Open in FUB** and **Open in Arive**.

**Body:**
- **Status:** Open / Working / Waiting on…, which is `work_items.status`, as today's Update. Working stamps a start time ("Started 9:58 · 6 min in").
- **Missing documents:** the borrower's Needed docs from `borrower_docs`, with when each was asked for. **Remind about all N** opens one drafted text or email listing them, through `sms:` or `mailto:` as the dialer's follow-ups do. The OS never sends it by itself.
- **Review steps:** the application checklist with checkboxes, saved on the work item.
- **Notes:** `work_items.notes`, shared with the assistant without dollar amounts.

**When done** (the outcome buttons today's Update > Review complete already offers):
- **Pre-approved**: FUB stage tag, then off review.
- **Disclosed**.
- **Reviewed, no change**: hidden for 3 days, as Mark reviewed is today.

Under the buttons, one line says what the choice will do. A suggested text to the realtor is offered as a draft link and is never sent automatically.

**Footer:** **Park · waiting on {borrower}**, **Save**, and **Done and next file**.

## 12. After the call

The After the call mockup. This upgrades the existing log sheets: `PostCallHost` and the Dialer's log step. It is not a new flow.

- **Outcome:** Reached, Voicemail, No answer and Bad number, on keys 1–4.
- **Note:** with a dictate button (`useSpeech`).
- **Next step chips:**
  - Call tomorrow, Next week and Pick a date;
  - one more chip suggested from a date in the note ("Check back Wed · gift letter"). Choosing it parks the file as waiting until that day, and it returns to the top of Calls that morning.
- **Loan files only:**
  - "Text {agent} the update", a drafted `sms:` link to the buyer's agent (`useLoanAgents`);
  - a stage picker that writes the FUB stage through crm-action.
- **Keys:** Enter saves and opens the next call. Esc saves and stays.
- **New lead, Voicemail or No answer:** one tap logs it, the cadence schedules the next attempt, the voicemail text is offered, and the next call opens. No note is needed. This is the cadence's behavior today.

## 13. Assistant view

The Assistant mockup. `role === 'assistant'`.

- **Shows:**
  - Hard dates, worded as tasks ("prepare the closing disclosure packet", "confirm the closing date with title");
  - Files, sorted by deadline, then age;
  - a Waiting on others summary;
  - + Work item.
- **Hides:** no Calls list, Next up, dialer or side panel, and no dollars, forecast or gap. This matches the assistant briefing (`assistantBriefing.js`).

## 14. End-of-day wrap

The End of day mockup. Opens from **Wrap up the day** in the header. Workbench offers it once the lists are done, or after 5:30 PM.

- **Today's counts:**
  - Calls done / list, with how many were reached;
  - Files done / list, with how many rolled;
  - Partners done / list;
  - Hard dates handled.
- **Moved a stage today:** each person with the move and its value (owner only).
- **{Month}:** funded + closing, and the gap now against this morning ("was $2,640 this morning").
- **Rolled to tomorrow:** what didn't get done, each pinned first in its list tomorrow (§4). An item untouched 5+ days is marked "Pinned first tomorrow".
- **Tomorrow:**
  - the theme and how many meetings;
  - the list sizes;
  - the first two items.
- **Close the day:** saves the wrap to `workbench_days.wrap`. The 7:30 briefing doesn't read it yet (decision 4); that's a follow-up.

---

## Data

**New table (decision 1):** `workbench_days`

| Column | |
|---|---|
| `user_id` | uuid, default `auth.uid()`, RLS per user |
| `day` | date (Central) |
| `set_at` | timestamptz, when the order was set |
| `lists` | jsonb: `{ calls: [key…], files: [key…], partners: [key…] }` |
| `pulled_in` | jsonb: keys added later |
| `closed_at` | timestamptz, null until Close the day |
| `wrap` | jsonb: the saved wrap (counts, rolled keys, tomorrow) |

The primary key is `(user_id, day)`. An item's key is the one each builder already uses: the contact id for calls, and the `source_key` / work item id for files.

**Reads:** the same hooks Workbench and Overview already use: `useDialList`, `useWorkLane`, `usePriorityQueue`, `useLeadRatings`, `useForecast`, `fetchLoanBundle` and `useLoanAgents`. Borrower docs come from `v_active_pipeline`; the open-file sheet reads `borrower_docs`.

**Writes, all existing paths:**
- crm-action `log_call`, stage tags and task complete;
- `work_items` (status, waiting, check back, notes, done);
- `dial_skips`.

**No CRM writes beyond what Workbench makes today.**

## Pure modules

- `workLists.js` grows to the full list composition (§6) and the day's order: `applyDayOrder(lists, saved, now)` returns `{ lists, newSince }`.
- `bookFlags.js` already has `hardDates`. It gains `hardDateTask(h)`, the assistant's wording.
- New `workValue.js`: an item's value and band (§8), and the At risk sum.
- New `dayWrap.js`: the end-of-day model from the day's order, the done items and the stage moves.

## Removed

- The two-lane layout and the mobile lane tabs.
- The header progress bars, which move to the side panel.
- The "More from Up Next" box and the `AlertsRail` tiles, replaced by the Slipping strip (§7).
- The Calls lane's separate theme, overdue and cadence boxes, which merge into the Calls list.

## Testing

- **Unit (vitest):**
  - `workLists` composition per weekday (borrower themes in Calls Tuesday to Thursday, realtor themes in Partners Monday and Friday);
  - the Slipping groups and counts;
  - `applyDayOrder`: set, done drops out, new arrivals go to New since, urgent kinds skip it, pull in, rolled items go first tomorrow;
  - `workValue` bands and the At risk sum;
  - `hardDateTask`;
  - `dayWrap`.
- **Render:** `Workbench.render.test.jsx` rewritten for:
  - the three lists, Next up and Hard dates;
  - the gap card linking to `/#forecast`;
  - the assistant view (no Calls, no dollars);
  - the phone layout.
- **Manual:** Overview's Your day counts match Workbench's lists; the keyboard shortcuts; 390 px.

## Build order (one PR each)

1. **Lists and layout:** the three list cards from `workLists`, Hard dates, the new-lead banner, and the side panel (gap card, At risk, counts). The Overview Start buttons honor `?list=`. No fixed order yet.
2. **Next up:** the card, Snooze and undo, and the keyboard.
3. **The day's order:** `workbench_days`, New since 8:00, Parked, Slipping, and rolled items.
4. **Open file.**
5. **After the call:** the upgrades to `PostCallHost` and the Dialer log.
6. **Assistant view.**
7. **End-of-day wrap**, on screen only.

## Out of scope

- "Give the statement logging to my assistant" from the wrap mockup: there's no assignee on `work_items` yet.
- Anniversary and birthday touches.
- Sending any text or email without Chandler tapping send.
- Changes to the Power Dialer's own screens.
- The 7:30 briefing reading the saved wrap (a follow-up after step 7).

---

## Decisions (Chandler, 2026-11-23)

1. **Fixed order.** Each list's order is set at the first load after 6 AM and held all day. Later arrivals wait in New since 8:00, except new leads, hard dates and people who reached out. Unfinished items go first tomorrow. Adds the `workbench_days` table (§4, Data).
2. **Borrower theme days go to the top of Calls.** Tuesday (loan status), Wednesday (past clients) and Thursday (pre-approved) lead Calls on their day. Partners holds only the realtor days, Monday (new realtors) and Friday (top partners), and is empty Tuesday to Thursday (§6).
3. **The alerts rail becomes a collapsed "Slipping · N" strip** under Parked. It holds Up Next's hot going cold, no next step, stuck in stage and gone quiet groups (§7).
4. **The wrap doesn't feed the briefing yet.** It ships on screen first; the 7:30 briefing reads it in a follow-up (§14).
