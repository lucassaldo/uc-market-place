-- Additional marketplace features. This migration is intentionally additive and safe to
-- run after 20260920000000_marketplace_profiles_chat.sql.

alter table public.listings add column if not exists seller text;
alter table public.listings add column if not exists image_url text;
alter table public.listings add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.listings add column if not exists status text not null default 'Available';
alter table public.listings add column if not exists created_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_status_check') then
    alter table public.listings add constraint listings_status_check
      check (status in ('Available', 'Pending', 'Sold'));
  end if;
end $$;

create index if not exists listings_status_created_idx
  on public.listings (status, created_at desc);
create index if not exists listings_category_idx on public.listings (category);
create index if not exists listings_seller_id_idx on public.listings (seller_id);

create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (listing_id, storage_path)
);
create index if not exists listing_images_listing_order_idx
  on public.listing_images (listing_id, sort_order);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists favorites_listing_idx on public.favorites (listing_id);

alter table public.listing_images enable row level security;
alter table public.favorites enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listing_images' and policyname = 'Authenticated users can read listing images') then
    create policy "Authenticated users can read listing images" on public.listing_images
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'listing_images' and policyname = 'Sellers can manage listing images') then
    create policy "Sellers can manage listing images" on public.listing_images
      for all to authenticated
      using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()))
      with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'favorites' and policyname = 'Users can read their favorites') then
    create policy "Users can read their favorites" on public.favorites for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'favorites' and policyname = 'Users can add favorites') then
    create policy "Users can add favorites" on public.favorites for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'favorites' and policyname = 'Users can remove favorites') then
    create policy "Users can remove favorites" on public.favorites for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

drop policy if exists "Buyers can create conversations" on public.conversations;
create policy "Buyers can create conversations" on public.conversations
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.seller_id = seller_id and l.status <> 'Sold'
    )
  );

drop policy if exists "Participants can update conversations" on public.conversations;
create policy "Participants can update conversations" on public.conversations
  for update to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid())
  with check (buyer_id = auth.uid() or seller_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do update set public = true;
