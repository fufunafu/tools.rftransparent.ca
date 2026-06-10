-- Daily warehouse report: track walk-in / pick-up orders, and retire the
-- "boxes_closed" / "shipments_booked" steps from the UI.
--
-- The old columns are intentionally NOT dropped — historical reports keep their
-- values; the form and dashboard simply stop surfacing them. Safe to re-run.

alter table warehouse_daily_reports
  add column if not exists walkin_pickup integer not null default 0;
