-- One shared OAuth access token per provider, so the Zoho functions (three
-- syncs and crm-action) stop minting a new token on every run and action.
-- Zoho caps refreshes at about 10 per 10 minutes; the MPG write-back live test
-- on 2026-10-20 hit "too many requests". See getAccessToken in _shared/zoho.ts.
-- Service role only: RLS on with no policies, so the app's signed-in and
-- anonymous roles can't read the token.
create table if not exists oauth_tokens (
  provider     text primary key,          -- 'zoho'
  access_token text not null,
  api_host     text,
  expires_at   timestamptz not null,
  source       text,                      -- last 6 chars of the refresh token it came from
  updated_at   timestamptz not null default now()
);

alter table oauth_tokens enable row level security;
revoke all on oauth_tokens from anon, authenticated;
