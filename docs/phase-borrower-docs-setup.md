# Borrower Docs — setup

Bayway pipeline cards show each borrower's outstanding documents and the last
conversation note. Document status comes from a Google Sheet the assistant
updates daily.

**Arive exposes no API and no webhooks.** The sheet is the permanent source of
truth for document status — there is no integration path to the LOS, now or
later, and no second system that could ever correct bad data here. That shapes
several decisions below; they are not arbitrary.

## 1. Build the sheet

One tab named exactly `Doc Status`. Row 1 is the header:

```
FUB ID | Borrower | Paystubs | W2 | Bank Statements | ID | Tax Returns | Notes
```

| Column | Required | Contents |
|---|---|---|
| `FUB ID` | yes | The number from the FollowUpBoss profile URL. The join key. |
| `Borrower` | no | Human-readable only. The sync ignores it. |
| *(anything else)* | — | A document type. `Needed`, `Received`, or blank. |
| `Notes` | no | Free text, shown verbatim on the card. |

Get a FUB ID from the profile URL: `https://baywayhtx.followupboss.com/2/people/view/2972` → `2972`.

Example rows:

```
2972 | Sarah Mitchell | Needed   | Needed   | Needed   | Received | Received | Sending W2 tomorrow
3104 | James Ortiz    | Received | Received | Received | Received | Received |
```

**Add data validation so typos cannot reach the sync.** Select the document
columns → Data → Data validation → Dropdown → values `Needed` and `Received` →
"Reject input". Blank stays valid and means "not required for this loan".

Document columns are discovered from the header row at runtime, so **adding a
document type is just adding a column** — no code change, no deploy. It appears
on the cards at the next sync.

### Rules the sync applies to bad input

These all favour showing nothing over showing something wrong. A confidently
incorrect document list on a borrower's card is worse than an absent one.

| Situation | What happens |
|---|---|
| `FUB ID` missing or not a number | Row skipped and counted. **Never matched by name.** |
| Same `FUB ID` on two rows | **Both** rows skipped and counted — the sync will not guess which is right. |
| Two columns with the same name (e.g. two `W2`) | That document type is dropped entirely and counted. Other columns still sync. |
| A cell value other than `Needed`/`Received`/blank | Treated as blank, counted, and the offending cell is named in the log. |
| Wholly blank row | Ignored silently (spreadsheet padding, not an error). |

## 2. Create the service account

1. Google Cloud console → create or pick a project.
2. Enable the **Google Sheets API**.
3. Create a **service account**, then create a **JSON key** for it.
4. Share the sheet with the service account's email address — **Viewer only**.

Viewer, not Editor. The app is read-only against the sheet by design; it must
never be able to modify the assistant's work.

**Do not use File → Share → Publish to web.** A published sheet is readable by
anyone with the URL and has been search-indexed in the past. This sheet contains
borrower names and their outstanding financial documents — exactly the data that
must not sit behind an unauthenticated URL. The service account exists to avoid
that.

## 3. Set the secrets

```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/key.json)"
supabase secrets set DOCS_SHEET_ID="<the long id in the sheet URL>"
```

PowerShell:

```powershell
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=(Get-Content path\to\key.json -Raw)
supabase secrets set DOCS_SHEET_ID="<the long id in the sheet URL>"
```

## 4. Deploy

Migrations first — the cron starts firing as soon as `0023` is applied, and it
will error every 15 minutes until the tables and the function both exist.

```bash
supabase db push                                          # 0021, 0022, 0023
supabase functions deploy sheets-docs-sync --no-verify-jwt
```

Set the secrets **before** the first tick, or the run logs an error and retries
on the next cycle.

## 5. Verify

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/sheets-docs-sync
```

On Windows use `curl.exe` — PowerShell aliases `curl` to `Invoke-WebRequest`.

Expected: `{"ok":true,"upserted":N,"borrowers":N}`.

The function returns its counts in the HTTP response because `borrower_docs`,
`borrower_doc_tracking`, and `sync_log` are all `authenticated`-read, so the
anon REST API cannot read them back.

### Worth running once, after the first real sync

The pipeline view runs a correlated lookup against `activities` for each contact
to fetch the last note. Migration `0021` adds
`idx_activities_contact_note_feed` to serve it, but whether Postgres skips that
lookup entirely for MPG rows — or runs it for all ~826 contacts and discards
half — is a planner decision that can only be observed against real data:

```sql
explain (analyze, buffers) select * from v_active_pipeline;
```

If the note lateral shows up as a sequential scan on `activities`, the index
isn't being used and it's worth investigating before the table grows.

## 6. Reading `sync_log`

The `sheets-docs` row reports what was skipped and why:

```
borrowers:34 (prev tracked:34) docChanges:2 trackingChanges:34 | skipped 1 with a bad FUB ID | 3 unrecognized cell values (2972/W2="Recieved", ...)
```

- **`prev tracked:N`** is logged every run on purpose. The empty-sheet guard only
  blocks a *total* wipe; a large-but-partial drop (say 40 borrowers down to 3) is
  allowed through deliberately, because blocking legitimate large edits would
  train whoever maintains the sheet to ignore the alarm. Comparing the two
  numbers is how a suspicious drop stays visible to a human.
- **Unrecognized values name the offending cells** (up to 10 samples; the count
  stays truthful past that) so a typo can be found in a sheet of hundreds of rows
  without re-reading it by eye.
- **`not yet matched to a contact`** is usually benign — the borrower is in the
  sheet but their FollowUpBoss contact hasn't synced yet. If it stays high, the
  FUB IDs in the sheet are wrong.

## 7. When the sync refuses to run

If the sheet reads as zero rows while borrowers are currently tracked, the sync
**aborts and writes nothing**, logging:

```
refusing to apply an empty sheet: 34 borrowers are currently tracked.
Check that the "Doc Status" tab exists and is still shared with the service account.
```

This almost always means the read failed, not that the sheet emptied. Check, in
order: the tab is still named `Doc Status`, the sheet is still shared with the
service account, and the service-account key hasn't been rotated or expired.

Without this guard, an auth failure would mark every borrower as removed and
flip every card to "Docs not tracked" — while the run logged success. With no
API on the Arive side, nothing would ever correct it.

A different message means the counts themselves were unreadable:

```
cannot assess sheet safety: previousCount is invalid (got null).
```

That points at the database read, not the sheet.

## What the cards show

| Card shows | Means |
|---|---|
| `⚠ 3 docs · oldest 12d` + names | Documents outstanding. Amber past 7 days, matching the stale-touch pill. |
| `✓ All docs received` | Borrower is in the sheet and owes nothing. |
| `Docs not tracked` | Borrower is **not in the sheet at all**. |

That last distinction is why there are two tables rather than one. "Not in the
sheet" must never render as "all clear" — the card would be confidently wrong
about a borrower nobody has entered yet.

Cards in the lost column, and all MPG cards, show no document block.

## Notes for whoever maintains this

- **Nothing is ever hard-deleted.** Removing a borrower or a column from the
  sheet stamps `removed_at`; the history stays. The database is the only backstop
  against a mistaken sheet edit.
- **`borrower_docs.tracking_id` uses `on delete restrict`, not `cascade`,** for
  the same reason. An accidental `DELETE` on a tracking row fails loudly instead
  of silently destroying that borrower's entire document history.
- **Aging timestamps are computed, never typed.** The sync diffs each run against
  stored state: blank→`Needed` stamps `first_requested_at`, `Needed`→`Received`
  stamps `received_at`. The assistant never enters a date.
- **All reads paginate** past PostgREST's 1000-row cap via `fetchAll` in
  `_shared/db.ts`. Do not simplify those back to a bare `.select()` — these tables
  only grow, and a truncated read silently resets every aging clock past the cap.
