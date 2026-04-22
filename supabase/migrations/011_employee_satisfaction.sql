-- Add phone (for WhatsApp) and birthday to employees
alter table employees
  add column if not exists phone text,
  add column if not exists birthday date;

-- Weekly satisfaction surveys
create table if not exists employee_surveys (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references employees(id) on delete cascade,
  token              text not null unique,
  week_of            date not null,
  sent_at            timestamptz not null default now(),
  responded_at       timestamptz,
  satisfaction_score integer check (satisfaction_score between 1 and 5),
  highlights         text,
  complaints         text,
  suggestions        text,
  created_at         timestamptz not null default now()
);

create index if not exists employee_surveys_employee_id_idx on employee_surveys(employee_id);
create index if not exists employee_surveys_week_of_idx on employee_surveys(week_of);
