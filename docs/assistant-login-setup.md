# Assistant login setup (Shelby)

Spec: docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md, section 3.
Plan: docs/superpowers/plans/2026-11-04-assistant-login-briefing.md.

Migration 0056 must be applied first (it creates `user_roles` and makes Chandler the owner).

## 1. Invite her (Chandler, Supabase dashboard)

Authentication > Users > Invite user > `shelby@baywayhtx.com`. Public sign-up stays off.
She sets her password from the invite email, then signs in at https://atkinson-sales-os.vercel.app.
Until step 2 she sees "This login has no access to the OS yet." and RLS returns nothing.

## 2. Give her the assistant role

```sql
insert into public.user_roles (user_id, role, books, name)
select id, 'assistant', array['bay'], 'Shelby Atkinson'
from auth.users where email = 'shelby@baywayhtx.com'
on conflict (user_id) do update set role = excluded.role, books = excluded.books, name = excluded.name;
```

## 3. What she can do

- Sees Workbench (Work lane), Tasks and Pipeline, Bayway only, and the Person sheet.
- Adds notes, schedules follow-ups and completes tasks. They reach FUB through Chandler's API key, so FUB shows them as his; the OS shows "by assistant".
- Cannot log calls, move stages, rate temperature, create leads or push tasks (crm-action refuses and records it).
- Never sees MPG, loans, commission, forecast, Reports, Settings or Sync Status.

## 4. Her briefing

`briefings.assistant_enabled` turns it on:

```sql
update public.settings set value = value || '{"assistant_enabled": true}'::jsonb where key = 'briefings';
```

Test send (goes to Chandler's owner_email): POST the `daily-briefing` function with headers
`x-briefing-test: <BRIEFING_TEST_KEY>` and `x-briefing-who: assistant`.

## Removing her

```sql
delete from public.user_roles where user_id = (select id from auth.users where email = 'shelby@baywayhtx.com');
```

Then delete the user in the dashboard if she should not sign in at all.
