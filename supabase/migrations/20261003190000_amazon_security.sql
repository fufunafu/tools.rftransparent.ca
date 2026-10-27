-- No existing passwords are certified. A verified MFA session and a new strong
-- password through /api/amazon/security are required before Amazon access.
create table public.amazon_password_compliance (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_revision timestamptz not null,
  changed_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz
);
alter table public.amazon_password_compliance enable row level security;
revoke all on public.amazon_password_compliance from public, anon, authenticated;
grant select, insert, update, delete on public.amazon_password_compliance to service_role;

create function public.invalidate_amazon_password_compliance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    insert into public.amazon_password_compliance (user_id, password_revision, changed_at, verified_at)
    values (new.id, new.updated_at, clock_timestamp(), null)
    on conflict (user_id) do update set
      password_revision = excluded.password_revision,
      changed_at = excluded.changed_at,
      verified_at = null;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_amazon_password_compliance() from public, anon, authenticated;
create trigger invalidate_amazon_password_compliance
after update of encrypted_password on auth.users
for each row execute function public.invalidate_amazon_password_compliance();

-- Only the server can certify a password it just validated and changed. Match
-- the exact Auth revision, so a concurrent or out-of-band reset cannot inherit
-- certification. Never return a password hash or accept a client-supplied date.
create function public.confirm_amazon_password(p_user_id uuid, p_auth_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_revision timestamptz;
  affected integer;
begin
  select updated_at into current_revision from auth.users where id = p_user_id for update;
  if current_revision is distinct from p_auth_updated_at then return false; end if;
  update public.amazon_password_compliance set verified_at = changed_at
  where user_id = p_user_id and password_revision = p_auth_updated_at
    and verified_at is null and changed_at > clock_timestamp() - interval '2 minutes';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.confirm_amazon_password(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_amazon_password(uuid, timestamptz) to service_role;
