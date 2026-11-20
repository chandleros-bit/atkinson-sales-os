# Power Dialer setup

Spec: `docs/superpowers/specs/2026-11-20-power-dialer-design.md`.

Order matters: the functions read tables the migrations create.

1. Apply the migrations:
   - `0072_power_dialer.sql`: dialer tables, RLS, `v_dialer_lists`, seeded scripts.
   - `0073_dialer_daily_numbers.sql`: dials and connects feed `metrics_daily`.
2. Optional dry run first (rolls back, nothing persists): concatenate the two
   migrations and `supabase/tests/power_dialer.sql` /
   `supabase/tests/dialer_daily_numbers.sql` in one transaction and run it with
   `npx supabase db query --linked -f <file>`.
3. Deploy `dialer-crm-check` **with** JWT verification (it is called from the
   browser and is owner only):
   `npx supabase functions deploy dialer-crm-check`
   It needs the same Zoho secrets as `crm-action` and a Zoho login with
   `ZohoCRM.coql.READ` (already required for MPG promotions).
4. Redeploy `gcal-push` (still `--no-verify-jwt`, called by pg_cron) so
   callbacks reach Google Calendar. Do this only after step 1, or every run
   fails on the missing `dialer_calls` table and no calendar events sync.

Notes
- Zoho COQL allows at most 25 criteria per query and needs conditions nested
  in pairs, so numbers are checked 12 at a time on Leads and Contacts (Phone
  and Mobile) and 25 at a time on Accounts, by their last 4 digits.
- The Bayway check reads FUB people already synced into `contacts`; it makes
  no FUB API calls.
