# Phase 5 — Zoho (MPG) sync setup

This connects the MPG side of the dashboard to Zoho CRM: a scheduled sync every
15 minutes that writes into Supabase. The app only ever reads from Supabase — it
never calls Zoho directly and never writes back to it.

Unlike FollowUpBoss (a static API key), Zoho uses OAuth2: you register an app
once, authorize it with a read-only scope, and get a long-lived **refresh token**
that the sync uses to mint short-lived access tokens.

The function is already deployed and scheduled. Until you complete the steps
below, the Sync Status screen shows "Zoho CRM (MPG)" in an error state
("credentials not set") — that's expected, nothing is broken.

## 0. Before you start

You'll need admin access to your Zoho account and the Supabase CLI (already set
up from Phase 2). If you're not sure you have API access, step 1 is where you'll
find out — if you can't reach api-console.zoho.com or can't create a client, ask
your Zoho admin to enable API access for your user.

Your account is on the **US data center** (`.com`), so you can skip the host
settings in step 3.

## 1. Register a Self Client and get client ID + secret

1. Go to **https://api-console.zoho.com** and sign in.
2. Click **Add Client → Self Client → Create**.
3. Copy the **Client ID** and **Client Secret**.

## 2. Generate a refresh token (read-only scope)

Still in the Self Client:

1. Open the **Generate Code** tab.
2. Scope: `ZohoCRM.modules.READ,ZohoCRM.settings.READ`
3. Time duration: 10 minutes. Scope Description: anything. Click **Create**, pick
   your CRM portal, **Create** again. Copy the **grant token** (code) shown.
4. Exchange the grant token for a refresh token (run this within 10 minutes;
   replace the three values). This is a Self Client, so there is **no**
   `redirect_uri`.

   PowerShell:

   ```powershell
   $body = @{
       grant_type    = "authorization_code"
       client_id     = "YOUR_CLIENT_ID"
       client_secret = "YOUR_CLIENT_SECRET"
       code          = "YOUR_GRANT_TOKEN"
   }
   $resp = Invoke-RestMethod -Method Post -Uri "https://accounts.zoho.com/oauth/v2/token" -Body $body
   $resp.refresh_token
   ```

   That prints the `refresh_token` (starts with `1000.`). Copy it — it does not
   expire unless you revoke it.

   > Don't paste a bash `curl ... \` command into PowerShell: `curl` there is an
   > alias for `Invoke-WebRequest` and the `\` line-continuations fail. If you
   > prefer curl, use `curl.exe` on a single line.

## 3. Set the function secrets

```powershell
supabase secrets set ZOHO_CLIENT_ID=your_client_id
supabase secrets set ZOHO_CLIENT_SECRET=your_client_secret
supabase secrets set ZOHO_REFRESH_TOKEN=your_refresh_token
```

(These `supabase` lines run the same in PowerShell and bash.)

(You're on the US `.com` data center, so no host secrets are needed. If that ever
changes, also set `ZOHO_ACCOUNTS_HOST` / `ZOHO_API_HOST` to your region.)

## 4. Trigger a sync and check Sync Status

The function runs every 15 min on its own; trigger one now.

PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync" `
  -Headers @{ Authorization = "Bearer YOUR_ANON_KEY" }
```

(Or with real curl on one line: `curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync" -H "Authorization: Bearer YOUR_ANON_KEY"`)

(`YOUR_ANON_KEY` = Supabase → Project Settings → API → anon public.)

Then open the **Sync Status** screen. Before you set the secrets it shows
"Zoho CRM (MPG)" with an error ("credentials not set"). After step 3 it should
flip to a green dot with a synced count.

## 5. Verify the data

```sql
select * from sync_log where source = 'zoho' order by ran_at desc limit 5;
select count(*) from contacts where source_crm = 'zoho';
select count(*) from deals where source_crm = 'zoho';
select name, is_won, is_lost from stages where business_id = 'mpg' order by sort_order;
```

## Field mapping — checked against your real Zoho (2026-07-11)

The mappings were built against your live **Media Payments Group** org, so there's
little guesswork. Current state: **3 Leads, 0 Contacts, 0 Deals** — your MPG
pipeline currently lives on **Leads** (`Lead_Status`). What that means:

- **Deals have no dollar amount field** (you use `Residual_Split` %,
  `Proposed_Pricing` text), so `deals.value` stays null until you populate a
  numeric field. `referral_partner` maps from `Software_Referral` ("Partner Name").
- **Stage won/lost** reads reliably from the Deal Stage's `forecast_type`
  (`Open` / `Closed Won` / `Closed Lost`).
- **It grows with you.** Each run pulls Leads + Contacts + Deals; empty modules
  are harmless. As you add records in Zoho they flow into MPG automatically.
- If you later track your pipeline in a **custom module** instead of the standard
  ones, tell the developer to add it to `_shared/zoho.ts`.

Any genuine surprise on a real run is logged to `sync_log.message`, visible on the
Sync Status screen — same workflow as FollowUpBoss.

## Zoho webhook (near-real-time) — later

This phase is scheduled-only (15-min). Zoho's Notifications API can push changes
for near-real-time updates; that's a later addition once the scheduled sync is
confirmed working, mirroring the FollowUpBoss webhook.
