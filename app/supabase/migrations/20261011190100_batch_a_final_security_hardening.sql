do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'listings'
  loop
    execute format('drop policy %I on public.listings', policy_record.policyname);
  end loop;
end;
$$;

create policy "Authenticated users can read active listings"
  on public.listings
  for select
  to authenticated
  using (
    removed_at is null
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

create policy "Sellers can create their own listings"
  on public.listings
  for insert
  to authenticated
  with check (seller_id = auth.uid());

create policy "Sellers and admins can update listings"
  on public.listings
  for update
  to authenticated
  using (
    seller_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    seller_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

create policy "Sellers can delete their own listings"
  on public.listings
  for delete
  to authenticated
  using (
    seller_id = auth.uid()
    and not exists (
      select 1
      from public.purchases p
      where p.listing_id = listings.id
    )
  );

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.profiles', policy_record.policyname);
  end loop;
end;
$$;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'conversations'
      and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.conversations', policy_record.policyname);
  end loop;
end;
$$;

create policy "Buyers can create conversations for valid listings"
  on public.conversations
  for insert
  to authenticated
  with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and exists (
      select 1
      from public.listings l
      where l.id = conversations.listing_id
        and l.seller_id = conversations.seller_id
        and l.removed_at is null
    )
  );

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'purchases'
      and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.purchases', policy_record.policyname);
  end loop;
end;
$$;

create policy "Buyers can create purchase requests for valid listings"
  on public.purchases
  for insert
  to authenticated
  with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and status = 'pending'
    and payment_method = 'online'
    and exists (
      select 1
      from public.listings l
      where l.id = purchases.listing_id
        and l.seller_id = purchases.seller_id
        and l.removed_at is null
        and coalesce(l.status, 'Available') = 'Available'
    )
  );

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (
        coalesce(qual, '') ilike '%listing-images%'
        or coalesce(with_check, '') ilike '%listing-images%'
      )
      and not exists (
        select 1
        from unnest(roles) as policy_role(role_name)
        join pg_roles r on r.rolname = policy_role.role_name
        where r.rolname = 'service_role'
      )
  loop
    execute format('drop policy %I on storage.objects', policy_record.policyname);
  end loop;
end;
$$;

create policy "Users can upload listing images to their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can update listing images in their own folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can delete listing images in their own folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
