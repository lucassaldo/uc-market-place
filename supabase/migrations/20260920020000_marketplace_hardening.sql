-- Idempotent hardening for the marketplace client. Run after the existing
-- marketplace migrations; this file is additive and is intentionally not
-- applied by the app.

alter table public.listings add column if not exists seller text;
alter table public.listings add column if not exists image text;
alter table public.listings add column if not exists image_url text;
alter table public.listings add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.listings add column if not exists status text not null default 'Available';
alter table public.listings add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listings_status_check'
      and conrelid = 'public.listings'::regclass
  ) then
    alter table public.listings add constraint listings_status_check
      check (status in ('Available', 'Pending', 'Sold'));
  end if;
end $$;

create or replace function public.create_marketplace_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do update
    set email = coalesce(excluded.email, profiles.email),
        full_name = coalesce(profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_marketplace_profile on auth.users;
create trigger on_auth_user_created_marketplace_profile
  after insert on auth.users
  for each row execute function public.create_marketplace_profile();

drop policy if exists "Buyers can create conversations" on public.conversations;
create policy "Buyers can create conversations" on public.conversations
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.seller_id = seller_id
        and coalesce(l.status, 'Available') <> 'Sold'
    )
  );

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      join public.listings l on l.id = c.listing_id
      where c.id = conversation_id
        and c.listing_id = listing_id
        and (
          (c.buyer_id = auth.uid() and c.seller_id = recipient_id)
          or (c.seller_id = auth.uid() and c.buyer_id = recipient_id)
        )
    )
  );

create index if not exists listings_seller_status_idx
  on public.listings (seller_id, status);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

alter table public.favorites enable row level security;

drop policy if exists "Users can read their favorites" on public.favorites;
create policy "Users can read their favorites" on public.favorites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can create their favorites" on public.favorites;
create policy "Users can create their favorites" on public.favorites
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their favorites" on public.favorites;
create policy "Users can delete their favorites" on public.favorites
  for delete to authenticated
  using (user_id = auth.uid());

create index if not exists favorites_listing_idx
  on public.favorites (listing_id);
