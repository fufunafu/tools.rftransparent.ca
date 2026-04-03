create table if not exists warehouse_daily_reports (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  report_date       date not null,
  boxes_built       integer not null default 0,
  orders_packed     integer not null default 0,
  boxes_closed      integer not null default 0,
  shipments_booked  integer not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, report_date)
);

create index if not exists idx_warehouse_reports_date
  on warehouse_daily_reports (report_date desc);

create index if not exists idx_warehouse_reports_employee
  on warehouse_daily_reports (employee_id, report_date desc);
