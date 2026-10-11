-- Replace all four values with the dedicated E2E listing, purchase, buyer, and seller IDs.
-- Returns only that listing and the purchase matching all supplied IDs.
with target as (
  select
    123456::bigint as listing_id,
    'PURCHASE_UUID'::uuid as purchase_id,
    'BUYER_UUID'::uuid as buyer_id,
    'SELLER_UUID'::uuid as seller_id
)
select
  l.id as listing_id,
  l.seller_id,
  l.status as listing_status,
  l.removed_at,
  p.id as purchase_id,
  p.buyer_id,
  p.seller_id as purchase_seller_id,
  p.status as purchase_status,
  p.payment_method,
  p.price,
  p.stripe_checkout_session_id,
  p.stripe_checkout_attempt,
  p.stripe_checkout_creating,
  p.stripe_checkout_claimed_at,
  p.stripe_payment_intent_id,
  p.paid_at,
  p.created_at
from target t
join public.listings l
  on l.id = t.listing_id
left join public.purchases p
  on p.id = t.purchase_id
  and p.listing_id = t.listing_id
  and p.buyer_id = t.buyer_id
  and p.seller_id = t.seller_id;
