-- Purchase request records for the marketplace Buy flow.
-- This migration is intentionally not applied by the app.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  -- Snapshot the existing formatted listings.price value, such as "$25".
  -- Keep this text because public.listings.price is currently text.
  price text not null check (length(trim(price)) > 0),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint purchases_participants_differ check (buyer_id <> seller_id),
  constraint purchases_status_check check (
    status in ('pending', 'accepted', 'declined', 'cancelled', 'completed')
  )
);

create index if not exists purchases_buyer_created_idx
  on public.purchases (buyer_id, created_at desc);
create index if not exists purchases_seller_created_idx
  on public.purchases (seller_id, created_at desc);
create index if not exists purchases_listing_created_idx
  on public.purchases (listing_id, created_at desc);

create unique index if not exists purchases_one_active_request_idx
  on public.purchases (listing_id, buyer_id)
  where status in ('pending', 'accepted');

alter table public.purchases enable row level security;

create policy "Participants can read purchase requests"
  on public.purchases
  for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "Buyers can create purchase requests"
  on public.purchases
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and exists (
      select 1
      from public.listings l
      where l.id = listing_id
        and l.seller_id = seller_id
        and coalesce(l.status, 'Available') = 'Available'
    )
  );
