-- Complete the clock-in location audit trail and prevent invalid store pins.

alter table public.locations
  add constraint locations_latitude_range
    check (latitude is null or latitude between -90 and 90) not valid,
  add constraint locations_longitude_range
    check (longitude is null or longitude between -180 and 180) not valid,
  add constraint locations_geofence_coordinates_pair
    check ((latitude is null) = (longitude is null)) not valid,
  add constraint locations_geofence_radius_requires_coordinates
    check (clock_in_radius_m is null or (latitude is not null and longitude is not null)) not valid;

alter table public.locations validate constraint locations_latitude_range;
alter table public.locations validate constraint locations_longitude_range;
alter table public.locations validate constraint locations_geofence_coordinates_pair;
alter table public.locations validate constraint locations_geofence_radius_requires_coordinates;

alter table public.time_entries
  add column if not exists clock_in_accuracy_m integer
    check (clock_in_accuracy_m is null or clock_in_accuracy_m between 0 and 10000),
  add column if not exists clock_in_position_captured_at timestamptz;

alter table public.time_entries
  add constraint time_entries_clock_in_distance_nonnegative
    check (clock_in_distance_m is null or clock_in_distance_m >= 0) not valid;

alter table public.time_entries validate constraint time_entries_clock_in_distance_nonnegative;
