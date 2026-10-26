-- Due day for your own Workbench items ("+ Work item" and the voice quick-add:
-- "MPG send Vinay the shipping receipt, today"). Dashboard only, like the rest
-- of work_items. Null = no due day.
alter table work_items add column if not exists due_on date;
