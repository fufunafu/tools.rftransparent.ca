-- Field sales: scheduled customer visits, explicit location check-ins,
-- mileage records, and business-card contacts.
--
-- Location is never collected in the background. A rep requests one fresh
-- reading when checking in. The first confirmed visit may establish the
-- customer-site pin; later visits are compared with that saved pin.

create table if not exists public.field_sales_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  latitude double precision,
  longitude double precision,
  pin_accuracy_m integer check (pin_accuracy_m is null or pin_accuracy_m between 0 and 10000),
  pin_captured_at timestamptz,
  pin_created_by_employee_id uuid references public.employees(id) on delete set null,
  verification_radius_m integer not null default 250
    check (verification_radius_m between 25 and 5000),
  created_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_sales_accounts_coordinates_pair
    check ((latitude is null) = (longitude is null)),
  constraint field_sales_accounts_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint field_sales_accounts_longitude_range
    check (longitude is null or longitude between -180 and 180)
);

create index if not exists field_sales_accounts_name_idx
  on public.field_sales_accounts (lower(name));

create table if not exists public.field_sales_appointments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  account_id uuid not null references public.field_sales_accounts(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'missed')),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_sales_appointments_end_after_start
    check (ends_at is null or ends_at > starts_at)
);

create index if not exists field_sales_appointments_employee_start_idx
  on public.field_sales_appointments (employee_id, starts_at desc);
create index if not exists field_sales_appointments_account_start_idx
  on public.field_sales_appointments (account_id, starts_at desc);
create index if not exists field_sales_appointments_status_start_idx
  on public.field_sales_appointments (status, starts_at);

create table if not exists public.field_sales_visits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  account_id uuid not null references public.field_sales_accounts(id) on delete restrict,
  appointment_id uuid references public.field_sales_appointments(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'completed')),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  check_in_latitude double precision not null check (check_in_latitude between -90 and 90),
  check_in_longitude double precision not null check (check_in_longitude between -180 and 180),
  check_in_accuracy_m integer not null check (check_in_accuracy_m between 0 and 10000),
  check_in_position_captured_at timestamptz not null,
  location_verification text not null
    check (location_verification in ('verified', 'pin_created', 'outside_radius', 'unverified')),
  distance_from_site_m integer check (distance_from_site_m is null or distance_from_site_m >= 0),
  odometer_start_km numeric(12,1) check (odometer_start_km is null or odometer_start_km >= 0),
  odometer_end_km numeric(12,1) check (odometer_end_km is null or odometer_end_km >= 0),
  mileage_km numeric(12,1) generated always as (
    case
      when odometer_start_km is not null and odometer_end_km is not null
        then odometer_end_km - odometer_start_km
      else null
    end
  ) stored,
  outcome text check (outcome is null or outcome in ('follow_up', 'quote_requested', 'sample_left', 'order_expected', 'not_interested', 'other')),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_sales_visits_checkout_after_checkin
    check (checked_out_at is null or checked_out_at > checked_in_at),
  constraint field_sales_visits_odometer_order
    check (odometer_end_km is null or odometer_start_km is null or odometer_end_km >= odometer_start_km)
);

create unique index if not exists field_sales_visits_one_open_per_employee
  on public.field_sales_visits (employee_id) where status = 'open';
create index if not exists field_sales_visits_employee_checkin_idx
  on public.field_sales_visits (employee_id, checked_in_at desc);
create index if not exists field_sales_visits_account_checkin_idx
  on public.field_sales_visits (account_id, checked_in_at desc);

create table if not exists public.field_sales_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  account_id uuid not null references public.field_sales_accounts(id) on delete restrict,
  visit_id uuid references public.field_sales_visits(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  job_title text check (job_title is null or char_length(job_title) <= 160),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 40),
  notes text check (notes is null or char_length(notes) <= 2000),
  card_path text unique,
  card_filename text,
  card_content_type text,
  card_size_bytes integer check (card_size_bytes is null or card_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists field_sales_contacts_account_idx
  on public.field_sales_contacts (account_id, created_at desc);
create index if not exists field_sales_contacts_employee_idx
  on public.field_sales_contacts (employee_id, created_at desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'field-sales-cards',
  'field-sales-cards',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The application accesses data through server routes using the service-role
-- key. Browser clients receive no direct table or storage access.
alter table public.field_sales_accounts enable row level security;
alter table public.field_sales_appointments enable row level security;
alter table public.field_sales_visits enable row level security;
alter table public.field_sales_contacts enable row level security;
