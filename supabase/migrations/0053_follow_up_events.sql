-- A follow-up scheduled with a time (Schedule follow-up, Log call > Follow-up)
-- also goes on the Calendar at that time, as a contact_events row of kind
-- 'follow_up'. The CRM task itself stays date-only; follow-ups without a time
-- write no row and stay off the Calendar, as before.
alter table contact_events drop constraint if exists contact_events_kind_check;
alter table contact_events
  add constraint contact_events_kind_check check (kind in ('call', 'meeting', 'follow_up'));
