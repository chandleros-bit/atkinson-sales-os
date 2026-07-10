# Phase 2 — FollowUpBoss sync setup

This wires the Bayway side of the dashboard to real data: a scheduled sync
every 15 minutes plus a webhook for near-real-time updates, both writing
into your Supabase database. The app itself only ever reads from Supabase —
it never calls FollowUpBoss directly and never writes back to it.

## 0. Before you start

You'll need:
- The Supabase project connected in Phase 1 (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` already in `.env`)
- The Supabase CLI (`npm install -g supabase`)
- Your FollowUpBoss API key: **FUB → Admin → API**

## 1. Apply the database schema

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

This runs `supabase/migrations/0001_init.sql`, creating the normalized tables
(`businesses`, `stages`, `contacts`, `deals`, `activities`, `calendar_events`,
`metrics_daily`, `sync_log`, `settings`) with read-only row-level security for
signed-in users. Edge Functions write using the service role key, which
bypasses RLS.

## 2. Set function secrets

```bash
supabase secrets set FUB_API_KEY=your_fub_api_key
supabase secrets set FUB_WEBHOOK_SECRET=$(openssl rand -hex 16)
supabase secrets set SUPABASE_URL=https://YOURPROJECT.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

`SUPABASE_SERVICE_ROLE_KEY` is under **Project Settings → API → service_role**.
Never put this key in `.env` or anywhere the browser can read it — it bypasses
RLS entirely. It only belongs in function secrets.

## 3. Deploy the Edge Functions

```bash
supabase functions deploy fub-sync --no-verify-jwt
supabase functions deploy fub-webhook --no-verify-jwt
```

`--no-verify-jwt` is needed because these are called by pg_cron and by
FollowUpBoss, not by a logged-in browser session. Note the URLs printed after
deploy — you'll need the `fub-webhook` one in step 5.

## 4. Schedule the 15-minute sync

Supabase runs cron via the `pg_cron` and `pg_net` extensions. In the SQL
Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fub-sync-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOURPROJECT.supabase.co/functions/v1/fub-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_ANON_OR_SERVICE_KEY',
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

Check it's registered with `select * from cron.job;`.

## 5. Register the webhook in FollowUpBoss

**FollowUpBoss → Admin → API → Webhooks → Add Webhook**

- URL: `https://YOURPROJECT.supabase.co/functions/v1/fub-webhook?secret=YOUR_FUB_WEBHOOK_SECRET`
  (the secret is the value you set in step 2)
- Events: subscribe to person created/updated and deal created/updated

## 6. Verify

```bash
curl -X POST https://YOURPROJECT.supabase.co/functions/v1/fub-sync \
  -H "Authorization: Bearer YOUR_ANON_OR_SERVICE_KEY"
```

Then check the **Sync Status** screen in the app, or query directly:

```sql
select * from sync_log order by ran_at desc limit 10;
select count(*) from contacts where source_crm = 'fub';
select count(*) from deals where source_crm = 'fub';
```

## Known unknowns — verify against your real FUB data

`supabase/functions/_shared/fub.ts` is written from FollowUpBoss's documented
API shape, but a few things vary by account setup and should be checked on
the first real sync:

- **Pagination and field names** on `/pipelines`, `/people`, `/deals` — the
  code assumes `_metadata`/array-wrapped responses; adjust `fubList()` if
  your account's shape differs.
- **Loan amount and commission fields** — currently mapped from `deal.price`.
  If your Bayway pipeline stores these as custom fields instead, update
  `mapDeal()`.
- **Referral partner** — not yet mapped. If it's a custom field or a tag on
  the person/deal, add it in `mapDeal()` or `mapContact()`.
- **Webhook payload shape** — FUB sends a lightweight event pointing at the
  changed resource rather than the full record. `fub-webhook/index.ts`
  re-fetches the resource before upserting either way, but confirm the exact
  field FUB uses to identify the resource (`resourceIds`, `personId`,
  `dealId`, etc.) from the first real delivery and adjust the parsing.
- **Won/lost detection** — `mapStage()` currently guesses from the stage
  name text ("funded", "won", "lost", "dead"). Once real stage names are in
  the `stages` table, it's more reliable to flag `is_won` / `is_lost`
  manually per row than to keep guessing from text.

None of this blocks deployment — the sync function logs errors with the raw
message to `sync_log`, so the Sync Status screen will show exactly what
needs adjusting on the first live run.

## Zoho (MPG) — next

Same pattern, different auth: Zoho uses OAuth2 with a refresh token instead
of a static API key, and you already have a webhook path from MPG's lead
capture flow that can be reused. That sync is the next piece after FUB is
confirmed working.
