-- Geofenced clock-in. A location with a pin (latitude/longitude) requires
-- employees to be within clock_in_radius_m of it to clock in; locations
-- without a pin keep trust-based clock-in, so this rolls out per store.

alter table public.locations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  -- Null = use the application default (200 m).
  add column if not exists clock_in_radius_m integer
    check (clock_in_radius_m is null or clock_in_radius_m between 25 and 5000);

-- Audit trail: how far from the store pin the phone reported itself at
-- clock-in. Null when the location had no pin (no check ran).
alter table public.time_entries
  add column if not exists clock_in_distance_m integer;
