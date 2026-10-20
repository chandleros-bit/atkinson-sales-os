-- Tier 1 slice 6: global search (Ctrl+K)
-- (docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md, section 5).
-- One row shape per contact for the search palette and the person sheet, over
-- both books and every contact, off-board ones included: search finds anyone.
-- Only Chandler's contacts are synced (0030), so there is no owner filter here.
-- Both objects are security invoker, so the app's read-only RLS applies.

create or replace view public.v_people
with (security_invoker = on) as
select
  c.id,
  c.business_id,
  c.name,
  c.company,
  c.phone,
  c.email,
  c.last_touch_at,
  -- Bayway: the board column when on the board, else the FUB person stage.
  case c.business_id
    when 'bay' then coalesce(public.derive_stage(c.raw, c.person_stage, c.business_id), c.person_stage)
    else c.person_stage
  end as stage,
  -- On its pipeline board right now (Bayway: a column that isn't Lost; MPG:
  -- the board shows every lead).
  case c.business_id
    when 'bay' then coalesce(public.derive_stage(c.raw, c.person_stage, c.business_id), 'Lost') <> 'Lost'
    else true
  end as on_board,
  case c.business_id
    when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
    when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
  end as crm_profile_url
from contacts c;

-- q: what was typed (2+ characters). Name, company and email match as a
-- case-insensitive substring; phone matches on digits once q has 3+ of them.
-- Order: name starts with q, a word in the name starts with q, then the book
-- in view (prefer: 'bay' | 'mpg' | null), on the board, most recently touched.
create or replace function public.search_people(q text, prefer text default null, max_rows int default 8)
returns setof public.v_people
language sql
stable
security invoker
set search_path = public
as $$
  with term as (
    select
      lower(trim(coalesce(q, ''))) as raw,
      -- LIKE wildcards in what was typed are literal.
      replace(replace(replace(lower(trim(coalesce(q, ''))), '\', '\\'), '%', '\%'), '_', '\_') as t,
      regexp_replace(coalesce(q, ''), '\D', '', 'g') as d
  )
  select p.*
  from public.v_people p, term
  where length(term.raw) >= 2
    and (
      lower(coalesce(p.name, '')) like '%' || term.t || '%'
      or lower(coalesce(p.company, '')) like '%' || term.t || '%'
      or lower(coalesce(p.email, '')) like '%' || term.t || '%'
      or (length(term.d) >= 3 and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || term.d || '%')
    )
  order by
    case
      when lower(coalesce(p.name, '')) like term.t || '%' then 0
      when lower(coalesce(p.name, '')) like '% ' || term.t || '%' then 1
      else 2
    end,
    (p.business_id is not distinct from prefer) desc,
    p.on_board desc,
    p.last_touch_at desc nulls last,
    p.name
  limit greatest(1, least(coalesce(max_rows, 8), 25));
$$;

grant execute on function public.search_people(text, text, int) to authenticated;
