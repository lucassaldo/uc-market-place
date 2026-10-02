alter table public.profiles
  add column if not exists role text not null default 'student';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('student', 'staff', 'admin'));
  end if;
end $$;

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'student';
  elsif new.role is distinct from old.role then
    raise exception 'Only trusted server-side operations can change profile roles'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_profile_role_escalation() from public;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation
  before insert or update of role on public.profiles
  for each row
  execute function public.prevent_profile_role_escalation();