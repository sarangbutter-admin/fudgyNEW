-- BakeByCulture migration 50: sameday time slots. When settings.sdSlotOn is true and sameday is still open (before the order-by hour),
-- the customer must pick one of the switched-on settings.sdSlots (one-hour boxes like "16 to 17"). A slot is "too soon" when it starts
-- before now + the sameday lead time. A slot can have a daily limit (paid orders, like the normal time slots).
-- After the cut-off (order placed with sdLate) there is no slot: the time stays "Same day (after cut-off)". Safe to run more than once.
do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%sdSlotOn%' then
    d := replace(d, $a$    dte := today; v_day := today::text; v_time := case when sh >= coalesce((s ->> 'samedayCutoff')::int, 15) then 'Same day (after cut-off)' else 'Same day' end;$a$,
$a$    dte := today; v_day := today::text;
    if sh >= coalesce((s ->> 'samedayCutoff')::int, 15) then v_time := 'Same day (after cut-off)';
    elsif coalesce((s ->> 'sdSlotOn')::boolean, false) and exists (select 1 from jsonb_array_elements(coalesce(s -> 'sdSlots', '[]'::jsonb)) w where coalesce((w ->> 'on')::boolean, true) and btrim(coalesce(w ->> 't', '')) <> '') then
      if not exists (select 1 from jsonb_array_elements(coalesce(s -> 'sdSlots', '[]'::jsonb)) w where w ->> 't' = v_time and coalesce((w ->> 'on')::boolean, true)) then
        perform public.bad('Please pick a time for your sameday delivery.'); end if;
      smin := public.slot_start_min(v_time);
      if smin is not null and smin < sh * 60 + extract(minute from (now() at time zone public.shop_tz()))::int + ceil(greatest(0, coalesce((s ->> 'samedayLeadH')::numeric, 3)) * 60)::int then
        perform public.bad('That time is too soon. Please pick a later time.'); end if;
      lim := coalesce((select (w ->> 'limit')::int from jsonb_array_elements(coalesce(s -> 'sdSlots', '[]'::jsonb)) w where w ->> 't' = v_time limit 1), 0);
      if lim > 0 and (select count(*) from public.orders o2 where o2.data ->> 'day' = v_day and o2.data ->> 'time' = v_time
                        and o2.data ? 'paidAt' and o2.status <> 'cancelled' and o2.id is distinct from edit_id) >= lim then
        perform public.bad('Sorry, that time slot is full. Please pick another time.'); end if;
    else v_time := 'Same day'; end if;$a$);
    execute d;
  end if;
end $$;
