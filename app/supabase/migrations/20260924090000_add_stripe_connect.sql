alter table public.profiles
  add column if not exists stripe_account_id text;

create unique index if not exists profiles_stripe_account_id_unique
  on public.profiles (stripe_account_id)
  where stripe_account_id is not null;
