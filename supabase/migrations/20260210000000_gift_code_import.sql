-- Delidome migration 41: pre-launch gift codes from a coupon CSV (owner only).
--  rows: [{code, phone, end (ms or null), active (bool), note}]; p_update = also change codes that already exist (end date and active only)
-- Safe to run more than once. Run after migration 40.
create or replace function public.admin_pre_gift_upsert(p_rows jsonb, p_update boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; cd text; pn text; r public.prelaunch_regs; ex bigint; act boolean; n_new int := 0; n_upd int := 0; n_skip int := 0; errs jsonb := '[]'::jsonb; t bigint := public.now_ms(); rk int;
begin
  perform public.assert_owner();
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000 then perform public.bad('Up to 2000 rows at a time.'); end if;
  perform pg_advisory_xact_lock(hashtext('delidome-prelaunch'));
  for x in select * from jsonb_array_elements(p_rows) loop
    cd := upper(regexp_replace(coalesce(x ->> 'code', ''), '[^A-Za-z0-9_-]', '', 'g'));
    pn := public.norm_phone(coalesce(x ->> 'phone', ''));
    ex := nullif(coalesce(x ->> 'end', ''), '')::bigint; act := coalesce((x ->> 'active')::boolean, true);
    if length(cd) < 3 or length(cd) > 24 then errs := errs || to_jsonb(cd || ': bad code'); continue; end if;
    select * into r from public.prelaunch_regs where code = cd;
    if r.id is not null then
      if not p_update then n_skip := n_skip + 1; continue; end if;
      update public.prelaunch_regs set exp = case when not act then least(coalesce(ex, t), t - 1000) else ex end where id = r.id;
      n_upd := n_upd + 1;
    else
      if exists (select 1 from public.coll where coll = 'coupons' and upper(data ->> 'code') = cd) then errs := errs || to_jsonb(cd || ': a coupon already uses this code'); continue; end if;
      if length(pn) < 7 then errs := errs || to_jsonb(cd || ': needs a WhatsApp number'); continue; end if;
      if exists (select 1 from public.prelaunch_regs where phone_norm = pn) then errs := errs || to_jsonb(cd || ': this WhatsApp number already has a gift code'); continue; end if;
      select coalesce(max(rank), 0) + 1 into rk from public.prelaunch_regs;
      insert into public.prelaunch_regs (rank, phone_norm, phone, name, code, at, exp)
        values (rk, pn, left(coalesce(x ->> 'phone', ''), 24), left(coalesce(x ->> 'note', ''), 80), cd, t, case when not act then t - 1000 else ex end);
      n_new := n_new + 1;
    end if;
  end loop;
  perform public.log_act('Imported gift codes', n_new || ' new, ' || n_upd || ' updated');
  return jsonb_build_object('added', n_new, 'updated', n_upd, 'skipped', n_skip, 'errors', errs);
end $$;
revoke all on function public.admin_pre_gift_upsert(jsonb, boolean) from public, anon;
grant execute on function public.admin_pre_gift_upsert(jsonb, boolean) to authenticated;
