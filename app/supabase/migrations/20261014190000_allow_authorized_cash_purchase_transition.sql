create or replace function public.enforce_purchase_status_update()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.buyer_id is distinct from new.buyer_id
    or old.seller_id is distinct from new.seller_id
    or old.listing_id is distinct from new.listing_id
    or old.price is distinct from new.price
    or old.created_at is distinct from new.created_at
  then
    raise exception
      using
        errcode = '42501',
        message = 'Only purchase status may be changed by the seller';
  end if;

  if old.status is not distinct from new.status then
    if coalesce(auth.role(), '') <> 'service_role'
      and current_user not in ('postgres', 'supabase_admin') then
      raise exception
        using
          errcode = '42501',
          message = 'Only trusted checkout operations may update checkout metadata';
    end if;

    if (to_jsonb(old) - array[
          'stripe_checkout_session_id',
          'stripe_checkout_attempt',
          'stripe_checkout_creating',
          'stripe_checkout_claimed_at'
        ])
      is distinct from
       (to_jsonb(new) - array[
          'stripe_checkout_session_id',
          'stripe_checkout_attempt',
          'stripe_checkout_creating',
          'stripe_checkout_claimed_at'
        ]) then
      raise exception
        using
          errcode = '42501',
          message = 'Only checkout metadata may be changed without a purchase status change';
    end if;

    return new;
  end if;

  if old.status = 'accepted' and new.status = 'cash_pending' then
    if coalesce(auth.role(), '') <> 'authenticated'
      or auth.uid() is distinct from old.buyer_id
      or old.payment_method is distinct from 'online'
      or new.payment_method is distinct from 'cash'
      or old.stripe_checkout_session_id is not null
      or old.stripe_checkout_creating
      or old.stripe_checkout_claimed_at is not null
      or old.stripe_payment_intent_id is not null
      or old.paid_at is not null
      or (to_jsonb(old) - array['status', 'payment_method'])
        is distinct from
         (to_jsonb(new) - array['status', 'payment_method'])
      or not exists (
        select 1
        from public.listings l
        where l.id = old.listing_id
          and l.status = 'Reserved'
      )
    then
      raise exception
        using
          errcode = '42501',
          message = 'Only the buyer may choose in-person payment for an unpaid, reserved purchase without an active Checkout session';
    end if;

    return new;
  end if;

  if old.status = 'cash_pending' and new.status = 'completed' then
    if coalesce(auth.role(), '') <> 'authenticated'
      or auth.uid() is distinct from old.seller_id
      or old.payment_method is distinct from 'cash'
      or new.payment_method is distinct from 'cash'
      or old.stripe_checkout_session_id is not null
      or old.stripe_checkout_creating
      or old.stripe_checkout_claimed_at is not null
      or old.stripe_payment_intent_id is not null
      or old.paid_at is not null
      or new.paid_at is null
      or (to_jsonb(old) - array['status', 'paid_at'])
        is distinct from
         (to_jsonb(new) - array['status', 'paid_at'])
      or not exists (
        select 1
        from public.listings l
        where l.id = old.listing_id
          and l.status = 'Reserved'
      )
    then
      raise exception
        using
          errcode = '42501',
          message = 'Only the seller may confirm cash received for an unpaid, reserved in-person purchase';
    end if;

    return new;
  end if;

  if old.status = 'accepted' and new.status = 'completed' then
    if coalesce(auth.role(), '') <> 'service_role'
      or old.payment_method is distinct from 'online'
      or new.payment_method is distinct from 'online'
      or old.stripe_checkout_session_id is null
      or old.stripe_checkout_creating
      or old.stripe_checkout_claimed_at is not null
      or old.stripe_payment_intent_id is not null
      or old.paid_at is not null
      or new.paid_at is null
      or (to_jsonb(old) - array['status', 'stripe_payment_intent_id', 'paid_at'])
        is distinct from
         (to_jsonb(new) - array['status', 'stripe_payment_intent_id', 'paid_at'])
      or not exists (
        select 1
        from public.listings l
        where l.id = old.listing_id
          and l.status = 'Reserved'
      )
    then
      raise exception
        using
          errcode = '42501',
          message = 'Only a verified online payment for the active reserved Checkout session may complete this purchase';
    end if;

    return new;
  end if;

  if old.status <> 'pending'
    or new.status not in ('accepted', 'declined') then
    raise exception
      using
        errcode = '42501',
        message = 'Purchase requests may only change from pending to accepted or declined';
  end if;

  return new;
end;
$function$;
