-- Editable loan close dates. Chandler can set a loan's closing date in the
-- OS when Arive's "Firm Closing Date" is stale or missing, and the change has
-- to survive the next Arive import and reach everything that reads a closing
-- date (forecast, Workbench hard dates, briefings, Slack alerts, lock watch).
--
--   * arive_closing_on: Arive's own date. The import writes this column now.
--   * close_override:   Chandler's date. The import never sends it.
--   * firm_closing_on:  stays the one effective date every reader uses, kept
--                       by the trigger below as coalesce(close_override,
--                       arive_closing_on). Nothing should write it directly.
--
-- When an import brings an Arive date equal to the override, Arive has caught
-- up and the override is cleared, so a later Arive change shows through.

alter table public.loans add column if not exists arive_closing_on date;
alter table public.loans add column if not exists close_override date;

update public.loans set arive_closing_on = firm_closing_on
where arive_closing_on is null and firm_closing_on is not null and close_override is null;

create or replace function public.loans_effective_closing()
returns trigger
language plpgsql
as $$
begin
  -- A writer that predates this migration (an app tab left open) still sends
  -- Arive's date as firm_closing_on: take it as the Arive date.
  if tg_op = 'INSERT' then
    if new.arive_closing_on is null then
      new.arive_closing_on := new.firm_closing_on;
    end if;
  elsif new.firm_closing_on is distinct from old.firm_closing_on
        and new.arive_closing_on is not distinct from old.arive_closing_on then
    new.arive_closing_on := new.firm_closing_on;
  end if;

  if tg_op = 'UPDATE'
     and new.close_override is not null
     and new.arive_closing_on is distinct from old.arive_closing_on
     and new.close_override = new.arive_closing_on then
    new.close_override := null;
  end if;

  new.firm_closing_on := coalesce(new.close_override, new.arive_closing_on);
  return new;
end;
$$;

drop trigger if exists loans_effective_closing on public.loans;
create trigger loans_effective_closing
  before insert or update on public.loans
  for each row execute function public.loans_effective_closing();
