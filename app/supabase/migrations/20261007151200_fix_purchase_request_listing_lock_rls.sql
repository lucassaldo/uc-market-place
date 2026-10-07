create or replace function public.validate_purchase_request_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_listing public.listings%rowtype;
begin
  if new.buyer_id <> auth.uid()
    or new.status <> 'pending'
    or new.payment_method <> 'online' then
    raise exception 'Purchase requests must be created by the signed-in buyer'
      using errcode = '42501';
  end if;

  select *
    into target_listing
    from public.listings
    where id = new.listing_id
    for update;

  if not found
    or target_listing.seller_id <> new.seller_id
    or target_listing.status <> 'Available'
    or target_listing.removed_at is not null then
    raise exception 'This listing is no longer available'
      using errcode = '23514';
  end if;

  new.price := target_listing.price;
  return new;
end;
$$;
