-- Delidome migration 42: pre-launch gift stock, and the surprise gift is drawn when the order moves past "awaiting payment" (like the old gift rules).
--  * every gift can have a stock (blank = unlimited); a drawn gift holds one unit until its order is cancelled
--  * the draw is fixed per gift code: a cancelled order frees the code AND the stock, but the same code always gets the same gift (no re-rolling / farming)
--  * checkout refuses a code when everything is gone, so nobody pays for a gift that is not there
-- Safe to run more than once. Run after migration 41.

alter table public.prelaunch_regs add column if not exists gift jsonb;
alter table public.prelaunch_regs add column if not exists gift_res jsonb not null default '[]'::jsonb;

-- the gift list with how many are used (reserved by live orders) and left
create or replace function public.pre_gift_pool() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'img', x.img, 'stock', x.stock, 'used', x.used,
           'left', case when x.stock is null then null else greatest(0, x.stock - x.used) end) order by x.n), '[]'::jsonb)
  from (select coalesce(nullif(i.v ->> 'id', ''), 'i' || (i.n - 1)) id, coalesce(i.v ->> 'name', '') name, coalesce(i.v ->> 'img', '') img,
          case when (i.v ->> 'stock') ~ '^[0-9]{1,6}$' then (i.v ->> 'stock')::int end stock, i.n,
          (select count(*) from public.prelaunch_regs r where r.gift_res @> to_jsonb(coalesce(nullif(i.v ->> 'id', ''), 'i' || (i.n - 1))))::int used
        from jsonb_array_elements(coalesce(public.pre_cfg() -> 'gifts' -> 'items', '[]'::jsonb)) with ordinality i(v, n)
        where btrim(coalesce(i.v ->> 'name', '')) <> '' or coalesce(i.v ->> 'img', '') <> '') x $$;

-- what the customer may see: set mode lists the gifts still in stock, surprise mode shows no names until the draw
create or replace function public.pre_gift_json() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.pre_cfg(); pool jsonb := public.pre_gift_pool(); mode text := coalesce(c -> 'gifts' ->> 'mode', 'set'); av jsonb;
begin
  select coalesce(jsonb_agg(e), '[]'::jsonb) into av from jsonb_array_elements(pool) e where (e ->> 'left') is null or (e ->> 'left')::int > 0;
  return jsonb_build_object('title', coalesce(nullif(c -> 'gifts' ->> 'title', ''), 'Free Gift Set'), 'mode', mode,
    'items', case when mode = 'surprise' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'img', e ->> 'img')), '[]'::jsonb) from jsonb_array_elements(av) e) end,
    'pool', jsonb_array_length(av), 'soldOut', jsonb_array_length(pool) > 0 and jsonb_array_length(av) = 0);
end $$;

-- null = fine, otherwise the message to show
create or replace function public.pre_gift_avail(r public.prelaunch_regs) returns text
language plpgsql stable security definer set search_path = public as $$
declare pool jsonb := public.pre_gift_pool();
begin
  if jsonb_array_length(pool) = 0 then return null; end if;
  if r.gift is not null then
    if not exists (select 1 from jsonb_array_elements(pool) e where r.gift @> to_jsonb(e ->> 'id') and ((e ->> 'left') is null or (e ->> 'left')::int > 0))
      then return 'Your gift is out of stock for now. Please try again later.'; end if;
  elsif not exists (select 1 from jsonb_array_elements(pool) e where (e ->> 'left') is null or (e ->> 'left')::int > 0)
    then return 'All the free gifts have been claimed.'; end if;
  return null;
end $$;

create or replace function public.pre_gift_check(p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); pn text := public.norm_phone(coalesce(p_phone, '')); m text;
begin
  if cd = '' or length(cd) > 24 then return jsonb_build_object('ok', false, 'gift', false); end if;
  if not public.lim_ip('pg-m', 'cpIpM', 20, 60000) then return jsonb_build_object('ok', false, 'gift', true, 'err', 'Too many tries. Please wait a moment.'); end if;
  select * into r from public.prelaunch_regs where code = cd;
  if r.id is null then return jsonb_build_object('ok', false, 'gift', false); end if;
  if r.used_order is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code was already used.'); end if;
  if r.exp is not null and r.exp < public.now_ms() then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code expired on ' || to_char(to_timestamp(r.exp / 1000.0) at time zone public.shop_tz(), 'DD Mon YYYY') || '.'); end if;
  if length(pn) >= 7 and pn <> r.phone_norm then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code belongs to another WhatsApp number.'); end if;
  m := public.pre_gift_avail(r);
  if m is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', m); end if;
  return jsonb_build_object('ok', true, 'gift', true, 'code', r.code, 'exp', r.exp, 'info', public.pre_gift_json());
end $$;

-- the order is placed: the code is held for it. The gift itself is drawn later (see orders_pre_draw).
create or replace function public.pre_gift_claim(p_id text, p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); g jsonb; t bigint := public.now_ms(); m text;
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
  m := public.pre_gift_avail(r);
  if m is not null then return jsonb_build_object('ok', false, 'err', m); end if;
  g := public.pre_gift_json() || jsonb_build_object('code', r.code, 'at', t, 'drawn', false);
  update public.prelaunch_regs set used_order = o.code, used_at = t where id = r.id;
  update public.orders set data = data || jsonb_build_object('preGift', g) where id = o.id;
  return jsonb_build_object('ok', true, 'gift', g);
end $$;

-- the order moves past "awaiting payment" (the payment proof is sent, or the team confirms it): the gift is drawn once
create or replace function public.orders_pre_draw() returns trigger
language plpgsql security definer set search_path = public as $$
declare pg jsonb := new.data -> 'preGift'; r public.prelaunch_regs; pool jsonb; av jsonb; ids jsonb := '[]'::jsonb; got jsonb; mode text;
begin
  if pg is null or coalesce((pg ->> 'drawn')::boolean, false) then return new; end if;
  if coalesce(new.data ->> 'status', '') in ('', 'awaiting', 'cancelled') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('delidome-pregift'));
  select * into r from public.prelaunch_regs where code = pg ->> 'code';
  if r.id is null then return new; end if;
  mode := coalesce(public.pre_cfg() -> 'gifts' ->> 'mode', 'set'); pool := public.pre_gift_pool();
  select coalesce(jsonb_agg(e), '[]'::jsonb) into av from jsonb_array_elements(pool) e where (e ->> 'left') is null or (e ->> 'left')::int > 0;
  if r.gift is not null then ids := r.gift;                                           -- same code, same gift: never re-rolled
  elsif mode = 'surprise' then
    if jsonb_array_length(av) > 0 then ids := jsonb_build_array((av -> floor(random() * jsonb_array_length(av))::int) ->> 'id'); end if;
  else select coalesce(jsonb_agg(e ->> 'id'), '[]'::jsonb) into ids from jsonb_array_elements(pool) e; end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into got from jsonb_array_elements(pool) e
    where ids @> to_jsonb(e ->> 'id') and ((e ->> 'left') is null or (e ->> 'left')::int > 0);
  update public.prelaunch_regs set gift = case when jsonb_array_length(ids) > 0 then ids else gift end,
    gift_res = (select coalesce(jsonb_agg(e ->> 'id'), '[]'::jsonb) from jsonb_array_elements(got) e) where id = r.id;
  new.data := new.data || jsonb_build_object('preGift', pg || jsonb_build_object('drawn', true, 'drawnAt', public.now_ms(), 'pool', jsonb_array_length(av),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'img', e ->> 'img')), '[]'::jsonb) from jsonb_array_elements(got) e),
    'soldOut', jsonb_array_length(got) = 0 and jsonb_array_length(pool) > 0));
  return new;
end $$;
create or replace trigger orders_pre_draw_trg before update on public.orders for each row execute function public.orders_pre_draw();

-- a cancelled order frees the code and returns the stock, but the draw stays fixed on the code
create or replace function public.orders_pre_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' and new.data ? 'preGift' then
    update public.prelaunch_regs set used_order = null, used_at = null, gift_res = '[]'::jsonb where used_order = new.code;
  end if;
  return new;
end $$;

-- the owner sees how many of each gift are used
create or replace function public.admin_prelaunch_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return jsonb_build_object('count', (select count(*) from public.prelaunch_regs), 'max', public.pre_max(), 'pool', public.pre_gift_pool(), 'list', coalesce((select jsonb_agg(jsonb_build_object(
    'rank', r.rank, 'name', r.name, 'phone', r.phone, 'email', r.email, 'code', r.code, 'at', r.at, 'exp', r.exp, 'order', r.used_order, 'usedAt', r.used_at,
    'status', case when r.used_order is not null then 'claimed' when r.exp is not null and r.exp < public.now_ms() then 'expired' else 'open' end) order by r.rank desc)
    from public.prelaunch_regs r), '[]'::jsonb));
end $$;

revoke all on function public.pre_gift_pool(), public.pre_gift_json(), public.orders_pre_draw(), public.orders_pre_release() from public, anon, authenticated;
revoke all on function public.pre_gift_avail(public.prelaunch_regs) from public, anon, authenticated;
revoke all on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) from public;
grant execute on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) to anon, authenticated;
