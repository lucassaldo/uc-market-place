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
