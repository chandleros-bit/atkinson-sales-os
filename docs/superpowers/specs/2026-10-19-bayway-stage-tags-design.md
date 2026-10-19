# Bayway Pipeline Stages from FUB Tags: Design

**Date:** 2026-10-19
**Status:** Approved in chat (Chandler: Option A; old `Imported Stage:` tags cleared; Smart Lists 03/04 filters fixed)

## Problem

Chandler wants the Bayway board to be **New Lead > Attempted > Contacted/Working > Application/Estimate Sent > Application Received**, kept in step with FollowUpBoss in both directions. FUB person stages can only be edited by the account owner, so the pipeline position lives in **tags**. His FUB Smart Lists (01–09) already filter on these tags, so the dashboard reads and writes the same tags rather than inventing new ones.

## Mapping (one config: `supabase/functions/_shared/bay-stages.ts`, mirrored in SQL `derive_stage`)

A lead is on the board only when its FUB person stage is **Lead** or **Pre-Qualified**. Nurture, Realtors, Closed, and Lost are off the board, whatever the tags say. A lead goes in the furthest column any of its tags reaches. Matching ignores case and surrounding spaces.

| Column | Tags (any) | Also | Smart Lists |
|---|---|---|---|
| New Lead | none of the below | | 01, 02 |
| Attempted | `attempted` | | (new) |
| Contacted/Working | `Working Estimate` | | 03 |
| Application/Estimate Sent | `estimate sent`, `application sent` | | 04, 05 |
| Application Received | `application received`, `need docs`, `under contract` | person stage Pre-Qualified | 06, 07, 09 |

## Writing back ("Move stage")

There are six targets: New Lead, Attempted, Contacted/Working, Estimate Sent, Application Sent, Application Received. The function reads the person's tags, removes the workflow tags that belong to *other* columns, keeps the target column's existing tags, and adds the target's own tag if it is missing (none for New Lead). It then saves the full tag list with `PUT /people/{id}` and mirrors the person back through `mapContact`.

- Estimate Sent and Application Sent share a column but are separate targets, so the right Smart List (04 or 05) gets the lead. Choosing one removes the other.
- `need docs` and `under contract` are kept when the target is Application Received, because they are later steps inside that column (Smart Lists 06 and 09).
- Non-workflow tags (`Active`, `HOT`, `DSCR`, …) are never touched.
- A Pre-Qualified person always shows as Application Received, so moving one to an earlier column is refused ("Change the FUB stage from Pre-Qualified first").
- MPG is out of scope: its stages come from the Zoho Lead Status.

## Knock-on changes

- `derive_stage()` is rewritten. Its output feeds `v_active_pipeline`, `v_lead_signals`, and stage tracking. The re-backfill of `stage_key` runs with the stage trigger disabled, so the relabel does not count as a stage change for "Stuck in stage".
- Reports' monthly auto metrics: `applications` now counts the Application/Estimate Sent column (it was the old `App Sent` stage), and `pre_approvals` ("in pre-approval now") counts Application Received (it was `Pre-Approved`).
- Board column order comes from `LOAN_FLOW_ORDER`, which now lists the five stages.
