create view public.seller_public_profiles
with (security_barrier = true, security_invoker = false)
as
select id, full_name, avatar_url
from public.profiles;

revoke all on table public.seller_public_profiles from public, anon, authenticated, service_role;
grant select on table public.seller_public_profiles to authenticated;
