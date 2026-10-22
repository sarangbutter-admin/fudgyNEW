-- Delidome migration 40: pre-launch gift codes at checkout.
--  * pre_gift_check: is this a valid, unused, unexpired pre-launch gift code (and, when a number is given, is it that customer's)?
--  * pre_gift_claim: right after an order is placed, the gift is attached to the order (data.preGift) and the code is marked used
--  * a cancelled order gives the code back
-- Safe to run more than once. Run after migration 39.

create or replace function public.pre_gift_json() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', coalesce(nullif(c -> 'gifts' ->> 'title', ''), 'Free Gift Set'), 'mode', coalesce(c -> 'gifts' ->> 'mode', 'set'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i ->> 'name', ''), 'img', coalesce(i ->> 'img', ''))) from jsonb_array_elements(coalesce(c -> 'gifts' -> 'items', '[]'::jsonb)) i), '[]'::jsonb))
  from (select public.pre_cfg() c) z $$;

create or replace function public.pre_gift_check(p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); pn text := public.norm_phone(coalesce(p_phone, ''));
begin
  if cd = '' or length(cd) > 24 then return jsonb_build_object('ok', false, 'gift', false); end if;
  if not public.lim_ip('pg-m', 'cpIpM', 20, 60000) then return jsonb_build_object('ok', false, 'gift', true, 'err', 'Too many tries. Please wait a moment.'); end if;
  select * into r from public.prelaunch_regs where code = cd;
  if r.id is null then return jsonb_build_object('ok', false, 'gift', false); end if;
  if r.used_order is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code was already used.'); end if;
  if r.exp is not null and r.exp < public.now_ms() then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code expired on ' || to_char(to_timestamp(r.exp / 1000.0) at time zone public.shop_tz(), 'DD Mon YYYY') || '.'); end if;
  if length(pn) >= 7 and pn <> r.phone_norm then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code belongs to another WhatsApp number.'); end if;
  return jsonb_build_object('ok', true, 'gift', true, 'code', r.code, 'exp', r.exp, 'info', public.pre_gift_json());
end $$;

create or replace function public.pre_gift_claim(p_id text, p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); g jsonb := public.pre_gift_json(); it jsonb; t bigint := public.now_ms();
begin
  if not public.owns(p_id, p_token) then return jsonb_build_object('ok', false, 'err', 'Please try again.'); end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.data ? 'preGift' or o.created_at < t - 900000 then return jsonb_build_object('ok', false, 'err', 'Please try again.'); end if;
  perform pg_advisory_xact_lock(hashtext('delidome-pregift'));
  select * into r from public.prelaunch_regs where code = cd;
  if r.id is null then return jsonb_build_object('ok', false, 'err', 'That gift code isn''t valid.'); end if;
  if r.used_order is not null and r.used_order <> o.code then return jsonb_build_object('ok', false, 'err', 'This gift code was already used.'); end if;
  if r.exp is not null and r.exp < t then return jsonb_build_object('ok', false, 'err', 'This gift code has expired.'); end if;
  if r.phone_norm <> o.phone_norm then return jsonb_build_object('ok', false, 'err', 'This gift code belongs to another WhatsApp number.'); end if;
  if g ->> 'mode' = 'surprise' and jsonb_array_length(g -> 'items') > 0 then
    it := (g -> 'items') -> floor(random() * jsonb_array_length(g -> 'items'))::int;
    g := g || jsonb_build_object('items', jsonb_build_array(it), 'pool', jsonb_array_length(g -> 'items'));
  end if;
  g := g || jsonb_build_object('code', r.code, 'at', t);
  update public.prelaunch_regs set used_order = o.code, used_at = t where id = r.id;
  update public.orders set data = data || jsonb_build_object('preGift', g) where id = o.id;
  return jsonb_build_object('ok', true, 'gift', g);
end $$;

-- a cancelled order gives the gift code back so the customer can use it again
create or replace function public.orders_pre_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' and new.data ? 'preGift' then
    update public.prelaunch_regs set used_order = null, used_at = null where used_order = new.code;
  end if;
  return new;
end $$;
create or replace trigger orders_pre_release_trg after update on public.orders for each row execute function public.orders_pre_release();

revoke all on function public.pre_gift_json(), public.orders_pre_release() from public, anon, authenticated;
revoke all on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) from public;
grant execute on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) to anon, authenticated;
