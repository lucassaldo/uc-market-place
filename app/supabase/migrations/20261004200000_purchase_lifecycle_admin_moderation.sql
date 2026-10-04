alter table public.listings
  add column if not exists removed_at timestamptz;

alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check
  check (status in ('Available', 'Pending', 'Reserved', 'Sold'));

alter table public.purchases
  add column if not exists payment_method text not null default 'online',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_checkout_attempt integer not null default 0,
  add column if not exists stripe_checkout_creating boolean not null default false,
  add column if not exists stripe_checkout_claimed_at timestamptz,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz;

alter table public.purchases
  drop constraint if exists purchases_status_check;

alter table public.purchases
  add constraint purchases_status_check
  check (
    status in (
      'pending',
      'accepted',
      'declined',
      'cancelled',
      'completed',
      'cash_pending'
    )
  );

alter table public.purchases
  drop constraint if exists purchases_payment_method_check;

alter table public.purchases
  add constraint purchases_payment_method_check
  check (payment_method in ('online', 'cash'));

alter table public.purchases
  drop constraint if exists purchases_checkout_attempt_check;

alter table public.purchases
  add constraint purchases_checkout_attempt_check
  check (stripe_checkout_attempt >= 0);

create or replace function public.guard_profile_stripe_account_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    if (tg_op = 'INSERT' and new.stripe_account_id is not null)
      or (tg_op = 'UPDATE' and new.stripe_account_id is distinct from old.stripe_account_id) then
      raise exception 'Stripe account links can only be changed by trusted server-side operations'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_stripe_account_id on public.profiles;
create trigger profiles_guard_stripe_account_id
  before insert on public.profiles
  for each row
  execute function public.guard_profile_stripe_account_id();

drop trigger if exists profiles_guard_stripe_account_id_update on public.profiles;
create trigger profiles_guard_stripe_account_id_update
  before update of stripe_account_id on public.profiles
  for each row
  execute function public.guard_profile_stripe_account_id();

drop policy if exists "Authenticated users can read listings" on public.listings;
create policy "Authenticated users can read listings"
  on public.listings
  for select to authenticated
  using (
    removed_at is null
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "Buyers can create purchase requests" on public.purchases;
create policy "Buyers can create purchase requests"
  on public.purchases
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and status = 'pending'
    and payment_method = 'online'
    and buyer_id <> seller_id
    and exists (
      select 1
      from public.listings l
      where l.id = listing_id
        and l.seller_id = seller_id
        and l.removed_at is null
        and coalesce(l.status, 'Available') = 'Available'
    )
  );

create or replace function public.guard_listing_moderation_and_reservation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    if new.removed_at is distinct from old.removed_at then
      raise exception 'Only an administrator can moderate a listing'
        using errcode = '42501';
    end if;

    if new.status = 'Reserved'
      or (old.status in ('Reserved', 'Sold') and new.status is distinct from old.status) then
      raise exception 'Listing reservations and completed sales cannot be changed directly'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_guard_moderation_and_reservation on public.listings;
create trigger listings_guard_moderation_and_reservation
  before update of status, removed_at on public.listings
  for each row
  execute function public.guard_listing_moderation_and_reservation();

create or replace function public.validate_purchase_request_insert()
returns trigger
language plpgsql
set search_path = public
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

drop trigger if exists purchases_validate_request_insert on public.purchases;
create trigger purchases_validate_request_insert
  before insert on public.purchases
  for each row
  execute function public.validate_purchase_request_insert();

create or replace function public.guard_purchase_state_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    if new.listing_id is distinct from old.listing_id
      or new.buyer_id is distinct from old.buyer_id
      or new.seller_id is distinct from old.seller_id
      or new.price is distinct from old.price
      or new.status is distinct from old.status
      or new.payment_method is distinct from old.payment_method
      or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
      or new.stripe_checkout_attempt is distinct from old.stripe_checkout_attempt
      or new.stripe_checkout_creating is distinct from old.stripe_checkout_creating
      or new.stripe_checkout_claimed_at is distinct from old.stripe_checkout_claimed_at
      or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
      or new.paid_at is distinct from old.paid_at then
      raise exception 'Purchase state can only be changed by an approved marketplace action'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists purchases_guard_state_changes on public.purchases;
create trigger purchases_guard_state_changes
  before update on public.purchases
  for each row
  execute function public.guard_purchase_state_changes();

create or replace function public.respond_to_purchase_request(
  p_purchase_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_listing_id bigint;
  target_seller_id uuid;
  target_status text;
begin
  if auth.uid() is null
    or p_decision is null
    or p_decision not in ('accepted', 'declined') then
    raise exception 'Invalid purchase decision'
      using errcode = '42501';
  end if;

  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.seller_id = auth.uid();

  if not found then
    raise exception 'Purchase request not found'
      using errcode = 'P0002';
  end if;

  perform 1
    from public.listings l
    where l.id = target_listing_id
    for update;

  select p.seller_id, p.status
    into target_seller_id, target_status
    from public.purchases p
    where p.id = p_purchase_id
    for update;

  if target_seller_id is distinct from auth.uid()
    or target_status is distinct from 'pending' then
    raise exception 'This purchase request is no longer pending'
      using errcode = '23514';
  end if;

  if p_decision = 'declined' then
    update public.purchases
      set status = 'declined'
      where id = p_purchase_id;
    return;
  end if;

  if exists (
    select 1
    from public.listings l
    where l.id = target_listing_id
      and (l.status <> 'Available' or l.removed_at is not null)
  ) then
    raise exception 'This listing is no longer available'
      using errcode = '23514';
  end if;

  update public.listings
    set status = 'Reserved'
    where id = target_listing_id;

  update public.purchases
    set status = 'accepted'
    where id = p_purchase_id;

  update public.purchases
    set status = 'declined'
    where listing_id = target_listing_id
      and id <> p_purchase_id
      and status = 'pending';
end;
$$;

create or replace function public.cancel_purchase_request(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchases
    set status = 'cancelled'
    where id = p_purchase_id
      and buyer_id = auth.uid()
      and status = 'pending';

  if not found then
    raise exception 'Only a pending request can be cancelled'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.begin_cash_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_listing_id bigint;
begin
  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.buyer_id = auth.uid();

  if not found then
    raise exception 'This accepted purchase cannot be changed to cash'
      using errcode = '23514';
  end if;

  perform 1
    from public.listings l
    where l.id = target_listing_id
    for update;

  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.buyer_id = auth.uid()
      and p.status = 'accepted'
      and p.payment_method = 'online'
      and p.stripe_checkout_session_id is null
      and not p.stripe_checkout_creating
    for update;

  if not found or not exists (
    select 1
    from public.listings l
    where l.id = target_listing_id
      and l.status = 'Reserved'
  ) then
    raise exception 'The listing is no longer reserved for this purchase'
      using errcode = '23514';
  end if;

  update public.purchases
    set status = 'cash_pending',
        payment_method = 'cash'
    where id = p_purchase_id;
end;
$$;

create or replace function public.confirm_cash_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_listing_id bigint;
begin
  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.seller_id = auth.uid()
      and p.status = 'cash_pending'
      and p.payment_method = 'cash';

  if not found then
    raise exception 'This cash purchase is not awaiting seller confirmation'
      using errcode = '23514';
  end if;

  perform 1
    from public.listings l
    where l.id = target_listing_id
    for update;

  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.seller_id = auth.uid()
      and p.status = 'cash_pending'
      and p.payment_method = 'cash'
    for update;

  if not found or not exists (
    select 1
    from public.listings l
    where l.id = target_listing_id
      and l.status = 'Reserved'
  ) then
    raise exception 'The listing is no longer reserved for this purchase'
      using errcode = '23514';
  end if;

  update public.purchases
    set status = 'completed',
        paid_at = now()
    where id = p_purchase_id;

  update public.listings
    set status = 'Sold'
    where id = target_listing_id;
end;
$$;

create or replace function public.expire_purchase_checkout(
  p_purchase_id uuid,
  p_checkout_session_id text,
  p_checkout_attempt integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchases
    set stripe_checkout_session_id = null,
        stripe_checkout_attempt = stripe_checkout_attempt + 1,
        stripe_checkout_creating = false,
        stripe_checkout_claimed_at = null
    where id = p_purchase_id
      and status = 'accepted'
      and payment_method = 'online'
      and (p_checkout_attempt is null or stripe_checkout_attempt = p_checkout_attempt)
      and (
        stripe_checkout_session_id = p_checkout_session_id
        or (stripe_checkout_session_id is null and stripe_checkout_creating)
      );
end;
$$;

create or replace function public.claim_purchase_checkout(
  p_purchase_id uuid,
  p_buyer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.purchases%rowtype;
  target_listing_id bigint;
  listing_status text;
begin
  select p.listing_id
    into target_listing_id
    from public.purchases p
    where p.id = p_purchase_id
      and p.buyer_id = p_buyer_id;

  if not found then
    raise exception 'Purchase request not found'
      using errcode = 'P0002';
  end if;

  perform 1
    from public.listings l
    where l.id = target_listing_id
    for update;

  select *
    into target
    from public.purchases p
    where p.id = p_purchase_id
      and p.buyer_id = p_buyer_id
    for update;

  if not found
    or target.status <> 'accepted'
    or target.payment_method <> 'online' then
    raise exception 'Purchase is not available for online payment'
      using errcode = '23514';
  end if;

  select l.status
    into listing_status
    from public.listings l
    where l.id = target.listing_id;

  if listing_status is distinct from 'Reserved' then
    raise exception 'Listing is no longer reserved for this purchase'
      using errcode = '23514';
  end if;

  if target.stripe_checkout_session_id is not null then
    return jsonb_build_object(
      'attempt', target.stripe_checkout_attempt,
      'session_id', target.stripe_checkout_session_id,
      'create', false,
      'busy', false
    );
  end if;

  if target.stripe_checkout_creating
    and target.stripe_checkout_claimed_at > now() - interval '3 minutes' then
    return jsonb_build_object(
      'attempt', target.stripe_checkout_attempt,
      'session_id', null,
      'create', false,
      'busy', true
    );
  end if;

  update public.purchases
    set stripe_checkout_creating = true,
        stripe_checkout_claimed_at = now()
    where id = p_purchase_id;

  return jsonb_build_object(
    'attempt', target.stripe_checkout_attempt,
    'session_id', null,
    'create', true,
    'busy', false
  );
end;
$$;

create or replace function public.save_purchase_checkout(
  p_purchase_id uuid,
  p_buyer_id uuid,
  p_checkout_attempt integer,
  p_checkout_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchases p
    set stripe_checkout_session_id = p_checkout_session_id,
        stripe_checkout_creating = false,
        stripe_checkout_claimed_at = null
    where p.id = p_purchase_id
      and p.buyer_id = p_buyer_id
      and p.status = 'accepted'
      and p.payment_method = 'online'
      and p.stripe_checkout_attempt = p_checkout_attempt
      and p.stripe_checkout_creating
      and exists (
        select 1
        from public.listings l
        where l.id = p.listing_id
          and l.status = 'Reserved'
      );

  if not found then
    raise exception 'Purchase changed before checkout could be saved'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.release_purchase_checkout_claim(
  p_purchase_id uuid,
  p_buyer_id uuid,
  p_checkout_attempt integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchases
    set stripe_checkout_creating = false,
        stripe_checkout_claimed_at = null
    where id = p_purchase_id
      and buyer_id = p_buyer_id
      and status = 'accepted'
      and stripe_checkout_session_id is null
      and stripe_checkout_attempt = p_checkout_attempt;
end;
$$;

create or replace function public.complete_online_purchase(
  p_purchase_id uuid,
  p_listing_id bigint,
  p_checkout_session_id text,
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_listing_id bigint;
  target_listing_id bigint;
  target_status text;
  target_method text;
  target_session_id text;
begin
  select p.listing_id
    into candidate_listing_id
    from public.purchases p
    where p.id = p_purchase_id;

  if not found then
    raise exception 'Purchase request not found'
      using errcode = 'P0002';
  end if;

  perform 1
    from public.listings l
    where l.id = candidate_listing_id
    for update;

  select p.listing_id, p.status, p.payment_method, p.stripe_checkout_session_id
    into target_listing_id, target_status, target_method, target_session_id
    from public.purchases p
    where p.id = p_purchase_id
    for update;

  if not found
    or target_listing_id is distinct from p_listing_id
    or target_method is distinct from 'online'
    or target_session_id is distinct from p_checkout_session_id then
    raise exception 'Payment does not match an active purchase'
      using errcode = '23514';
  end if;

  if target_status = 'completed' then
    return;
  end if;

  if target_status <> 'accepted' then
    raise exception 'Purchase is not awaiting online payment'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.listings l
    where l.id = target_listing_id
      and l.status = 'Reserved'
  ) then
    raise exception 'Listing is no longer reserved for this purchase'
      using errcode = '23514';
  end if;

  update public.purchases
    set status = 'completed',
        stripe_payment_intent_id = p_payment_intent_id,
        paid_at = now()
    where id = p_purchase_id;

  update public.listings
    set status = 'Sold'
    where id = target_listing_id;
end;
$$;

create or replace function public.admin_remove_listing(p_listing_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  ) then
    raise exception 'Only administrators can moderate listings'
      using errcode = '42501';
  end if;

  update public.listings
    set removed_at = coalesce(removed_at, now())
    where id = p_listing_id;

  if not found then
    raise exception 'Listing not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.respond_to_purchase_request(uuid, text) from public, anon;
revoke all on function public.cancel_purchase_request(uuid) from public, anon;
revoke all on function public.begin_cash_purchase(uuid) from public, anon;
revoke all on function public.confirm_cash_purchase(uuid) from public, anon;
revoke all on function public.admin_remove_listing(bigint) from public, anon;
revoke all on function public.expire_purchase_checkout(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.claim_purchase_checkout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_purchase_checkout(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.release_purchase_checkout_claim(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_online_purchase(uuid, bigint, text, text) from public, anon, authenticated;

grant execute on function public.expire_purchase_checkout(uuid, text, integer) to service_role;
grant execute on function public.claim_purchase_checkout(uuid, uuid) to service_role;
grant execute on function public.save_purchase_checkout(uuid, uuid, integer, text) to service_role;
grant execute on function public.release_purchase_checkout_claim(uuid, uuid, integer) to service_role;
grant execute on function public.respond_to_purchase_request(uuid, text) to authenticated;
grant execute on function public.cancel_purchase_request(uuid) to authenticated;
grant execute on function public.begin_cash_purchase(uuid) to authenticated;
grant execute on function public.confirm_cash_purchase(uuid) to authenticated;
grant execute on function public.admin_remove_listing(bigint) to authenticated;
grant execute on function public.complete_online_purchase(uuid, bigint, text, text) to service_role;
