# Borrower docs tracked in the OS: Design

**Date:** 2026-11-05
**Status:** Approved design; not built.
**Replaces:** the Google Sheet feed in `docs/phase-borrower-docs-setup.md` (sheet `Doc Status` + `sheets-docs-sync`).

## Why

Document status comes from a Google Sheet that `sheets-docs-sync` reads every 15 minutes. The sheet was never adopted: it holds 3 test borrowers (FUB 3051, 3063, 3064) unchanged since Jul 22, so 27 open loans have no doc tracking, and those 3 rows would show in Shelby's briefing as 106 days old. Shelby now has her own OS login (Bayway only), so she can keep doc status in the OS directly.

## Decisions (2026-11-05)

- **Start:** automatic. When a Bayway lead first reaches Application Received, the OS adds the standard checklist, all Needed.
- **FUB:** no writes. Docs live in the OS only.
- **Sheet:** retired. Stop the sync and hide the 3 test borrowers (history kept).

## Approach

Keep `borrower_doc_tracking`, `borrower_docs` and the doc columns of `v_active_pipeline` exactly as they are. Only the writer changes, from the sheet sync to the OS. Every reader keeps working unchanged: Pipeline cards (`contactCard.loanView`), Workbench (`workbench.js`, `useWorkLane`), alerts "Docs aging" (`alerts.js`), Chandler's Slipping list and Shelby's Missing docs (`assistantBriefing.js`).

Rejected:
- A new contact-keyed table: every reader above would need rewriting.
- Writes through `crm-action`: it exists to reach FUB, and nothing goes to FUB.

## 1. Schema (migration `0057_docs_in_os.sql`)

New columns on `borrower_docs`:

| Column | Type | Meaning |
|---|---|---|
| `received_by_name` | text | Name (from `user_roles.name`) of who marked it Received |
| `updated_by` | uuid | `auth.uid()` of the last OS edit; null for sheet-era rows |

`borrower_docs.status` keeps its check (`needed`, `received`). "Removed" stays `removed_at` (hidden, never deleted). The `on delete restrict` foreign key stays.

Default checklist, one SQL function so the trigger, the backfill and the UI's "Set up docs" share it:

```sql
create or replace function public.default_borrower_docs() returns text[]
language sql immutable as $$ select array['Paystubs','W2','Bank statements','ID','Tax returns'] $$;
```

## 2. Seeding the checklist

`public.seed_borrower_docs(p_contact uuid)`, SECURITY DEFINER, internal (execute revoked from `public`, `anon` and `authenticated`):

1. Reads the contact. Does nothing unless `business_id = 'bay'` and `external_id` is set.
2. If an **active** tracking row exists for `fub_person_id = external_id`, does nothing (a lead that moves back and forth is never reset).
3. Otherwise inserts the tracking row (`contact_id`, `fub_person_id`), or re-activates a removed one (`removed_at = null`).
4. For each default doc type, upserts on `(tracking_id, doc_type)`:
   - no row, or a removed row: `status = 'needed'`, `first_requested_at = now()`, `received_at = null`, `received_by_name = null`, `removed_at = null`;
   - an active row: left as is.

Trigger `contacts_seed_docs`, AFTER INSERT OR UPDATE OF `stage_key` on `contacts`, calls it when `new.business_id = 'bay'` and `new.stage_key = 'Application Received'` and (`tg_op = 'INSERT'` or `old.stage_key is distinct from new.stage_key`). `contacts_track_stage` is a BEFORE trigger, so `stage_key` is final when this AFTER trigger runs.

**Launch backfill** (in the migration, after the sheet retire step): `seed_borrower_docs(id)` for every Bayway contact whose `stage_key = 'Application Received'`. Their aging starts on launch day. Leads in later stages are not seeded: their files may be complete and a fresh Needed list would raise false alerts. Chandler or Shelby set those up with "Set up docs" when useful.

## 3. Editing

Three RPCs, SECURITY DEFINER, `set search_path = public`, granted to `authenticated` only:

```
set_borrower_doc(p_contact uuid, p_doc_type text, p_status text) returns void
set_borrower_doc_note(p_contact uuid, p_note text) returns void
setup_borrower_docs(p_contact uuid) returns void   -- "Set up docs": the default list, Needed
```

Guards, in order (each raises a short error the UI shows):
1. Caller is the owner or an assistant (`app_role() in ('owner','assistant')`), else `not allowed`.
2. The contact exists, `business_id = 'bay'`, and `can_read_book('bay')`, else `Bayway contacts only`.
3. `set_borrower_doc` only: `p_status in ('needed','received','removed')`, else `bad status`.
4. `set_borrower_doc` only: `p_doc_type` trimmed, 1 to 60 characters, else `doc name must be 1-60 characters`. An existing row for the file matching case-insensitively is reused (its stored spelling is kept).

`set_borrower_doc` creates or re-activates the tracking row when needed (as in seeding step 3), then:

| New status | Stamps |
|---|---|
| `needed` | if the doc is not already active and Needed: `status = 'needed'`, `first_requested_at = now()`, `received_at = null`, `received_by_name = null`, `removed_at = null` (switching back from Received restarts the clock) |
| `received` | `status = 'received'`, `received_at = now()`, `received_by_name = <caller's user_roles.name>`, `removed_at = null` |
| `removed` | `removed_at = now()` (no-op if the doc does not exist) |

Every write sets `updated_by = auth.uid()` and `updated_at = now()`, and touches the tracking row's `updated_at`. `set_borrower_doc_note` creates or re-activates the tracking row and sets `notes` (trimmed; empty becomes null; over 500 characters raises `note must be 500 characters or fewer`). `setup_borrower_docs` runs the same guards, then the seeding logic (steps 2 to 4), so it does nothing on a file that is already tracked.

Direct INSERT/UPDATE on both tables stays closed to `authenticated` (read-only RLS from 0021/0056 unchanged); the RPCs are the only write path.

## 4. UI: Person sheet, Loan tab, Docs block

Replaces the read-only Docs block in `PersonSheet.jsx` (Bayway, on the board). Mockup approved 2026-11-05.

- Header: `DOCS · N of M needed · oldest Xd` (M counts active docs; "oldest" only when N > 0).
- One row per active doc, Needed first (oldest request first), then Received (newest first):
  - Needed row: name, days waiting (`12d`), and a red `chase` tag at 7+ days (`CHASE_DAYS` from `assistantBriefing.js`);
  - Received row: date and who, e.g. `Nov 2 · Shelby`;
  - a Needed / Received segmented switch;
  - an × that removes the doc (no confirm; adding the doc again brings it back as Needed).
- An "Add a doc" text box and button (Enter adds; new docs start Needed).
- "Doc note": one text field, saved on blur when changed.
- Untracked lead: "Docs not set up" and a "Set up docs" button (`setup_borrower_docs`).
- Each change calls the RPC, then reloads the doc list and the board row, so cards and the Workbench count update. A failure shows the RPC's message under the block and reloads, so the screen matches the database.
- Data: the full list comes from `borrower_docs` joined through `borrower_doc_tracking` (`fub_person_id = contacts.external_id`, tracking not removed, doc not removed), not from the view, because the view only carries outstanding names. Both tables are readable by owner and assistant (0056).
- Owner and assistant see and edit the same block. MPG people never show it.

New pure module `src/lib/docChecklist.js`, tested on its own:
- `docRows(rows, now)`: sort, days waiting, chase flag, received label;
- `docSummary(rows, now)`: header counts and oldest days;
- `cleanDocName(s)`: trimmed name or null when empty or over 60 characters.

## 5. Retiring the sheet

In migration 0057, before the backfill:
- Unschedule `sheets-docs-sync-15min` (guarded so a missing job does not fail the migration).
- `update borrower_docs set removed_at = now() where removed_at is null`, and the same on `borrower_doc_tracking`. At migration time every active row came from the sheet (the 3 test borrowers).

Left in place, unused: the `sheets-docs-sync` function code, the `GOOGLE_SERVICE_ACCOUNT_JSON` and `DOCS_SHEET_ID` secrets, and its old `sync_log` rows. `docs/phase-borrower-docs-setup.md` gets a "Retired 2026-11-05" note at the top pointing here. If Sync Status lists `sheets-docs` and shows it as stale, it is dropped from that list.

## 6. Testing

- `supabase/tests/docs_in_os.sql`, in a transaction that ends in rollback:
  - updating a Bayway contact's stage to Application Received seeds 5 Needed docs; a second stage change back and forth does not reseed or reset clocks;
  - an MPG contact is never seeded;
  - as the owner: received stamps `received_at` and `received_by_name`; back to needed restarts `first_requested_at`; removed drops it from `v_active_pipeline.docs_outstanding`;
  - as the assistant: allowed on a Bayway contact, refused on an MPG contact;
  - a direct `insert into borrower_docs` as `authenticated` is refused.
- `src/lib/docChecklist.test.js` for the pure helpers.
- A render test for the Docs block: the switch calls the RPC with `received`, × calls it with `removed`, add calls it with `needed`, "Set up docs" calls `setup_borrower_docs`, and an RPC error shows its message.
- Existing alert, workbench, card and briefing tests stay unchanged and must pass.

## Rollout (each step needs Chandler's OK)

1. `supabase db push` (dry run first) for 0057: unschedules the sheet sync, hides the 3 test rows, seeds current Application Received leads.
2. Run `supabase/tests/docs_in_os.sql`.
3. Merge the PR (Vercel deploys the UI). Until it merges, the live app shows the seeded docs read-only, as today.
4. Shelby reviews the seeded checklists and removes docs that don't apply.

## Out of scope

Doc requests to the borrower (email or text), uploads, FUB notes, per-loan-type checklists, editing the default list in Settings.
