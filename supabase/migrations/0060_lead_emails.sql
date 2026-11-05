-- Application Sent email (spec 2026-11-05-application-sent-email-design.md).
-- One row per lead and templated email: the claim that keeps the email from
-- ever going out twice. crm-action (service role) writes; the owner reads.
create table if not exists public.lead_emails (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  template_key     text not null,
  variant          text not null,
  to_email         text,
  status           text not null check (status in ('pending', 'tagged', 'failed')),
  client_action_id uuid,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  tagged_at        timestamptz,
  unique (contact_id, template_key)
);

alter table public.lead_emails enable row level security;

drop policy if exists "owner read lead_emails" on public.lead_emails;
create policy "owner read lead_emails" on public.lead_emails
  for select to authenticated using (public.is_owner());

-- Off until the FUB templates and automations exist (docs/app-email-setup.md).
insert into public.settings (key, value)
values ('app_email', '{"enabled": false, "templates": {}, "published_years": null}'::jsonb)
on conflict (key) do nothing;
