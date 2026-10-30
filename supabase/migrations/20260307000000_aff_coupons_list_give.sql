-- Delidome migration 66: the admin coupon table also shows how many points each affiliator gives to their customers.
create or replace function public.admin_aff_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'username', a.username, 'code', a.code, 'rate', a.rate, 'status', a.status,
    'coupon', a.coupon, 'crule', a.crule, 'give', public.aff_give_eff(a),
    'uses', (select count(*) from public.orders o where o.data -> 'aff' ->> 'id' = a.id and o.data ->> 'coupon' is not null and upper(o.data ->> 'coupon') = upper(a.coupon) and o.status <> 'cancelled')) order by a.created_at)
    from public.affiliates a), '[]'::jsonb);
end $$;
