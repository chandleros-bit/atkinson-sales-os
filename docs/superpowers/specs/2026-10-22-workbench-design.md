# Workbench (Priority as calls + work): Design

**Date:** 2026-10-22
**Status:** Approved in chat 2026-10-22 (decisions below)
**Mockup:** Up Next Redesign canvas, bottom row "Priority as a workbench" (https://claude.ai/artifact/C4oTDxfVv4mRJaf4fCB3so)

## Problem

Priority (Up Next) only answers "who do I call?". The rest of the day's work happens in FUB, Zoho and Chandler's head:
- Bayway estimates that need working.
- Applications that need review.
- MPG statements and proposals.

Nothing shows that work in one place, how old it is, or whether it's blocked on someone else. Before a call there's no quick read of where the lead came from or what they asked for.

## What it is

The Priority page becomes the **Workbench**, with two lanes (the mockup's "Workbench · Calls + Work"):

- **Header:** "Calls 6/15" and "Work 2/7" progress bars for today, plus **+ Work item**.
- **Calls lane:** today's Up Next queue (the existing ranking, daily cap and buckets), each row trimmed to:
  - book badge, name and **lead source** tag (FUB `source`, Zoho `Lead_Source`)
  - the one reason (red when it's an act-now bucket)
  - **first-note facts:** the lead's first note, split on ` / ` into `key: value` chips (e.g. Credit 660-699 · DSCR Purchase · North Carolina · $200K - $500K). The email is left off because it's already on the lead.
  - a dark call button showing the formatted number. Log, note and follow-up move into ⋯.
  - **Start calling** stays as an entry point; the call session itself is Tier 2.
- **Work lane:** three groups, each item showing what, who, why now, a rough time and **Start** / **Done**:
  - **Estimates to Work (Bayway):** leads in Contacted/Working (tag `Working Estimate`), oldest first. "Why now" = days in the stage (`stage_since`) and any due follow-up.
  - **Applications to Review (Bayway):** Application Received files that need review (rule: open question 2).
  - **Statement/Proposal Review (MPG):** merchants whose statements are in or whose proposal needs review (signal: open question 1).
  - **Waiting on others:** a collapsed bar for items parked as waiting on the borrower, lender, processor or underwriter, each with a "check back" date.
- **Work item open** (the mockup's "Work item open"): what, who, status switch **Working / Waiting on…**, a **checklist** for the category (open question 3), notes, links (FUB/Zoho, docs tracker, last call). **Done** can also move the CRM stage:
  - Estimate: tag → `estimate sent` and a follow-up call tomorrow.
  - Application: no stage change.
  - Statement/Proposal: optional Zoho status change.
- **Phone:** a **Calls | Work** switch, the same cards stacked, and **+ Work item** at the bottom.

## Data

- **Calls lane:** `v_lead_signals` as today, plus:
  - `lead_source`: FUB `raw->>'source'` (all 1156 Bayway contacts have it); Zoho `raw->>'Lead_Source'` (659 MPG leads).
  - `first_note`: the earliest note text per contact. **Gap:** most first notes aren't synced. Only 48 Bayway contacts have any note, and CJ Blackman's "Credit: 660-699 / …" note isn't one of them. The activity sync only pulls notes for recently touched leads, and lead-provider details (LendingFlow, Lendgo…) may arrive as the lead's first FUB event rather than a note.
  - **Fix:** a small step in `fub-sync`. For each new or untouched-but-not-yet-fetched lead, read its earliest note (and, if none, its first event's message) once and store it on the contact (`contacts.first_note`, `first_note_at`). For MPG, Zoho's lead `Description` field.
- **Work lane:** a new **`work_items`** table (RLS like the rest) holding what the CRMs can't:
  - `id, business_id, contact_id, kind ('estimate' | 'application' | 'statement' | 'custom'), title, status ('open' | 'working' | 'waiting' | 'done'), waiting_on, check_back_on, checklist jsonb, notes, created_at, done_at`.
  - Estimate and application items are **generated** from CRM state (a view joins the pipeline with `work_items` for status and checklist). The row is created the first time you Start or park one, so nothing duplicates CRM data.
  - Custom items (+ Work item) are rows of kind `custom`.
- **Progress:**
  - Calls = distinct leads touched today (as now).
  - Work = `work_items` done today versus open plus done today.

## Out of scope (Tier 2)

The full call session (one lead at a time) and the lead side panel. The Workbench links to them later.

## Build slices (one PR each)

1. **Lead source + first-note facts** on Up Next rows, and the `fub-sync` first-note fetch (plus the Zoho Description).
2. **Workbench layout:** two lanes, header progress, the renamed nav item, phone switch. The Work lane is driven by CRM state only (Estimates, Applications, MPG once its signal exists); Start and Done link to the CRM.
3. **`work_items`:** status, Waiting on, checklists, notes, custom items, Work progress, and the stage change on Done.

## Decisions (Chandler, 2026-10-22)

1. **MPG Statement/Proposal Review = open Zoho tasks.** Every open Zoho task on an MPG lead (e.g. "3 Statements FU") is an MPG work item; completing it in the Workbench completes the Zoho task.
2. **Applications to Review = weekly review.** Every Application Received file shows until it's marked reviewed, then comes back 7 days later.
3. **No checklists in v1.** Work items get status (Working / Waiting on…), check-back date and notes; checklists can come later.
4. **Rename** the Priority / Up Next nav item to **Workbench**; the Calls lane keeps the Up Next ranking.
