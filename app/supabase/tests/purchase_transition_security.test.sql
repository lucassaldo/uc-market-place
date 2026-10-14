begin;

select plan(23);

create trigger purchase_transition_regression_enforce_status
  before update on public.purchases
  for each row
  execute function public.enforce_purchase_status_update();

grant select, update on public.purchases to authenticated;

select ok(
  (
    select count(*) = 2
    from pg_trigger
    where tgrelid = 'public.purchases'::regclass
      and not tgisinternal
      and tgfoid in (
        'public.enforce_purchase_status_update()'::regprocedure,
        'public.guard_purchase_state_changes()'::regprocedure
      )
  ),
  'Both purchase status and state-guard triggers are attached during regression tests'
);

create temporary table purchase_transition_users (
  user_type text primary key,
  id uuid not null default gen_random_uuid()
) on commit drop;

insert into purchase_transition_users (user_type)
values ('buyer'), ('seller'), ('other_buyer');

insert into auth.users (id, aud, role, email)
select id, 'authenticated', 'authenticated',
       'purchase-transition-' || user_type || '@example.test'
from purchase_transition_users;

create temporary table purchase_transition_listings (
  case_name text primary key,
  listing_id bigint not null
) on commit drop;

with new_listings as (
  insert into public.listings (
    title, description, category, price, seller_id, seller, status
  )
  select 'Transition test ' || cases.case_name,
         'Temporary database regression fixture',
         'Other',
         '$4',
         seller.id,
         'Transition test seller',
         'Available'
  from (values
    ('cash-selection'),
    ('wrong-buyer'),
    ('checkout-active'),
    ('online-completion'),
    ('unsupported-transition')
  ) as cases(case_name)
  cross join purchase_transition_users seller
  where seller.user_type = 'seller'
  returning id, title
)
insert into purchase_transition_listings (case_name, listing_id)
select replace(title, 'Transition test ', ''), id
from new_listings;

create temporary table purchase_transition_purchases (
  case_name text primary key,
  purchase_id uuid not null,
  listing_id bigint not null
) on commit drop;
grant select on purchase_transition_purchases to authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'buyer'),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);

with new_purchases as (
  insert into public.purchases (
    listing_id, buyer_id, seller_id, price, status
  )
  select l.listing_id,
         (select id from purchase_transition_users where user_type = 'buyer'),
         (select id from purchase_transition_users where user_type = 'seller'),
         '$4',
         'pending'
  from purchase_transition_listings l
  returning id, listing_id
)
insert into purchase_transition_purchases (case_name, purchase_id, listing_id)
select l.case_name, p.id, p.listing_id
from new_purchases p
join purchase_transition_listings l on l.listing_id = p.listing_id;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);

select public.respond_to_purchase_request(purchase_id, 'accepted')
from purchase_transition_purchases;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);

select lives_ok(
  format(
    'select public.begin_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'cash-selection')
  ),
  'The buyer can choose cash for an accepted purchase without an active Checkout session'
);

select is(
  (select status from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'cash-selection'
  )),
  'cash_pending',
  'Choosing cash leaves the purchase awaiting seller confirmation'
);

select is(
  (select payment_method from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'cash-selection'
  )),
  'cash',
  'The accepted purchase records the buyer-selected in-person payment method'
);

select is(
  (select paid_at from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'cash-selection'
  )),
  null::timestamptz,
  'Choosing cash does not mark the purchase as paid'
);

select throws_ok(
  format(
    'select public.begin_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'cash-selection')
  ),
  '23514',
  'The listing is no longer reserved for this purchase',
  'A second cash-selection request cannot submit the purchase again'
);

select throws_ok(
  format(
    $query$
      insert into public.purchases (listing_id, buyer_id, seller_id, price, status)
      select %L, %L, %L, '$4', 'pending'
    $query$,
    (select listing_id from purchase_transition_purchases where case_name = 'cash-selection'),
    (select id from purchase_transition_users where user_type = 'buyer'),
    (select id from purchase_transition_users where user_type = 'seller')
  ),
  '23514',
  'This listing is no longer available',
  'A second purchase request cannot be created for the reserved listing'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'other_buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'other_buyer'),
    'role', 'authenticated'
  )::text,
  true
);

select throws_ok(
  format(
    'select public.begin_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'wrong-buyer')
  ),
  '23514',
  'This accepted purchase cannot be changed to cash',
  'A different buyer cannot choose cash for the purchase'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
update public.purchases
set stripe_checkout_session_id = 'cs_transition_test_active'
where id = (
  select purchase_id from purchase_transition_purchases where case_name = 'checkout-active'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'buyer'),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);

select throws_ok(
  format(
    'select public.begin_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'checkout-active')
  ),
  '23514',
  'The listing is no longer reserved for this purchase',
  'An active Checkout session prevents switching to cash'
);

select is(
  (select status from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'checkout-active'
  )),
  'accepted',
  'A rejected cash-choice request leaves the online purchase accepted'
);

select throws_ok(
  format(
    $query$
      update public.purchases
      set status = 'declined'
      where id = %L
    $query$,
    (select purchase_id from purchase_transition_purchases where case_name = 'unsupported-transition')
  ),
  '42501',
  'Purchase requests may only change from pending to accepted or declined',
  'A direct accepted-to-declined status change remains forbidden'
);

set local role authenticated;
select throws_ok(
  format(
    $query$
      update public.purchases
      set status = 'cash_pending', payment_method = 'cash'
      where id = %L
    $query$,
    (select purchase_id from purchase_transition_purchases where case_name = 'unsupported-transition')
  ),
  '42501',
  'Purchase state can only be changed by an approved marketplace action',
  'The state guard rejects direct writes even when the status trigger permits the transition'
);
reset role;

select throws_ok(
  format(
    'select public.confirm_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'cash-selection')
  ),
  '23514',
  'This cash purchase is not awaiting seller confirmation',
  'The buyer cannot confirm receipt of cash'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);

select lives_ok(
  format(
    'select public.confirm_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'cash-selection')
  ),
  'The seller can confirm the in-person exchange'
);

select is(
  (select status from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'cash-selection'
  )),
  'completed',
  'Seller confirmation completes the cash purchase'
);

select isnt(
  (select paid_at from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'cash-selection'
  )),
  null::timestamptz,
  'Cash paid_at is set only after seller confirmation'
);

select throws_ok(
  format(
    'select public.confirm_cash_purchase(%L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'cash-selection')
  ),
  '23514',
  'This cash purchase is not awaiting seller confirmation',
  'Seller confirmation cannot be submitted again after cash completion'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
update public.purchases
set stripe_checkout_session_id = 'cs_transition_test_online'
where id = (
  select purchase_id from purchase_transition_purchases where case_name = 'online-completion'
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from purchase_transition_users where user_type = 'buyer'),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from purchase_transition_users where user_type = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);

select throws_ok(
  format(
    'select public.complete_online_purchase(%L, %L, %L, %L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'online-completion'),
    (select listing_id from purchase_transition_purchases where case_name = 'online-completion'),
    'cs_transition_test_online',
    'pi_transition_test'
  ),
  '42501',
  'Only a verified online payment for the active reserved Checkout session may complete this purchase',
  'Authenticated users cannot invoke the online-completion transition'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);

select lives_ok(
  format(
    'select public.complete_online_purchase(%L, %L, %L, %L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'online-completion'),
    (select listing_id from purchase_transition_purchases where case_name = 'online-completion'),
    'cs_transition_test_online',
    'pi_transition_test'
  ),
  'The service-role payment completion workflow accepts the matching active session'
);

select is(
  (select status from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'online-completion'
  )),
  'completed',
  'Verified online completion completes the purchase'
);

select is(
  (select stripe_payment_intent_id from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'online-completion'
  )),
  'pi_transition_test',
  'Verified online completion records the payment intent'
);

select lives_ok(
  format(
    'select public.complete_online_purchase(%L, %L, %L, %L)',
    (select purchase_id from purchase_transition_purchases where case_name = 'online-completion'),
    (select listing_id from purchase_transition_purchases where case_name = 'online-completion'),
    'cs_transition_test_online',
    'pi_duplicate_event'
  ),
  'A duplicate verified Stripe completion is handled idempotently'
);

select is(
  (select stripe_payment_intent_id from public.purchases where id = (
    select purchase_id from purchase_transition_purchases where case_name = 'online-completion'
  )),
  'pi_transition_test',
  'A duplicate Stripe event does not replace the recorded payment intent'
);

select * from finish();
rollback;
