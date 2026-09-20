create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.listings add column if not exists seller_id uuid references auth.users(id) on delete restrict;
alter table public.profiles add column if not exists email text;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_participants_differ check (buyer_id <> seller_id),
  constraint conversations_listing_participants_unique unique (listing_id, buyer_id, seller_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  constraint messages_participants_differ check (sender_id <> recipient_id)
);

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do update set public = true;

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Authenticated users can read profiles" on public.profiles for select to authenticated using (true);
create policy "Users can insert their profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users can update their profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Authenticated users can read listings" on public.listings for select to authenticated using (true);
create policy "Users can create their own listings" on public.listings for insert to authenticated with check (seller_id = auth.uid());
create policy "Users can update their own listings" on public.listings for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy "Users can delete their own listings" on public.listings for delete to authenticated using (seller_id = auth.uid());

create policy "Participants can read conversations" on public.conversations for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());
create policy "Buyers can create conversations" on public.conversations for insert to authenticated with check (buyer_id = auth.uid() and buyer_id <> seller_id);
create policy "Participants can update conversations" on public.conversations for update to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid()) with check (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "Participants can read messages" on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())));
create policy "Participants can send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and sender_id <> recipient_id and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.listing_id = listing_id
      and ((c.buyer_id = auth.uid() and c.seller_id = recipient_id) or (c.seller_id = auth.uid() and c.buyer_id = recipient_id))
  )
);

create policy "Anyone can read listing images"
  on storage.objects for select
  using (bucket_id = 'listing-images');
create policy "Users can upload listing images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can update their listing images"
  on storage.objects for update to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete their listing images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
