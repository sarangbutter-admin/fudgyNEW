-- BakeByCulture migration 31: delivery days and the evening courier stop.
--  * Sameday after the order-by time: a customer who saw the "Sameday closed" pop-up and still chose Sameday
--    can order it (the order is marked "Same day (after cut-off)")
--  * Scheduled delivery is never today: tomorrow at the earliest, up to "schedMaxDays" days (Delivery & courier, default 7)
--  * an hourly job calls the courier webhook function: in the evening it stops the driver search for bookings made
--    before the stop time, and the next morning it searches again (both set in Delivery & courier)
-- Safe to run more than once. Run after migration 30.

do $$
declare
  r text[][] := array[
    ['if sh >= coalesce((s ->> ''samedayCutoff'')::int, 15) then',
     'if sh >= coalesce((s ->> ''samedayCutoff'')::int, 15) and coalesce(p ->> ''sdLate'', '''') <> ''true'' then'],
    ['dte := today; v_day := today::text; v_time := ''Same day'';',
     'dte := today; v_day := today::text; v_time := case when sh >= coalesce((s ->> ''samedayCutoff'')::int, 15) then ''Same day (after cut-off)'' else ''Same day'' end;'],
    ['if sh >= coalesce((s ->> ''cutoffHour'')::int, 20) then earliest := earliest + 1; end if;',
     'if sh >= coalesce((s ->> ''cutoffHour'')::int, 20) then earliest := earliest + 1; end if;
    if v_speed = ''scheduled'' and earliest <= today then earliest := today + 1; end if;'],
    ['if dte < earliest or dte > earliest + 6 then',
     'if dte < earliest or dte > earliest + (case when v_speed = ''scheduled'' then greatest(1, least(60, coalesce((s ->> ''schedMaxDays'')::int, 7))) else 7 end) - 1 then']];
  i int; d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'place_order' limit 1;
  n := d;
  for i in 1 .. array_length(r, 1) loop
    if position(r[i][2] in n) = 0 then n := replace(n, r[i][1], r[i][2]); end if;
  end loop;
  if n <> d then execute n; end if;
end $$;

-- the hourly courier job (the webhook secret is read when it runs, it is not stored in the job)
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('dd-courier-sweep', '0 * * * *', $job$
  select net.http_post(
    url := 'https://mxkzsdjekhcuvdgsyvpr.supabase.co/functions/v1/biteship-webhook?k=' || coalesce((select data ->> 'v' from public.private_kv where key = 'webhook_secret'), ''),
    body := '{"cron":"sweep"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
