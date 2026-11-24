-- Workbench v2, step 6 (spec 2026-11-23-workbench-v2-design.md, §13): the
-- assistant's hard dates. loans is owner-only (0056), but the assistant needs
-- each open file's closing and lock dates to prepare the closing disclosure
-- and confirm closings, as her briefing email already shows her. This returns
-- only those fields: no amounts, comp, rates or borrower details. Anyone who
-- can read the Bayway book (owner or assistant) gets the rows; anyone else
-- gets none.

create or replace function public.workbench_hard_dates()
returns table (
  id               uuid,
  contact_id       uuid,
  borrower_name    text,
  stage            text,
  stage_group      text,
  firm_closing_on  date,
  lock_expires_on  date
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.contact_id, l.borrower_name, l.stage, l.stage_group, l.firm_closing_on, l.lock_expires_on
  from public.loans l
  where public.can_read_book('bay')
    and l.business_id = 'bay'
    and l.funded_on is null
    and l.stage_group in ('prospect', 'processing', 'closing')
    and not coalesce(l.scenario_override, l.scenario_auto, false)
    and (l.firm_closing_on is not null or l.lock_expires_on is not null)
$$;

revoke all on function public.workbench_hard_dates() from public, anon;
grant execute on function public.workbench_hard_dates() to authenticated;
