create table if not exists birthday_message_deliveries (
  id                     uuid primary key default gen_random_uuid(),
  celebration_date       date not null,
  birthday_employee_id   uuid references employees(id) on delete set null,
  birthday_employee_name text not null,
  recipient_employee_id  uuid references employees(id) on delete set null,
  recipient_name         text not null,
  kind                   text not null check (kind in ('greeting', 'coworker_reminder')),
  provider_message_id    text unique,
  status                 text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'failed')),
  delivery_error         text,
  sent_at                timestamptz,
  delivered_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (celebration_date, birthday_employee_id, recipient_employee_id, kind)
);

create index if not exists birthday_message_deliveries_date_status_idx
  on birthday_message_deliveries(celebration_date, status);

alter table birthday_message_deliveries enable row level security;
