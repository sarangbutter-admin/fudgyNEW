-- BakeByCulture migration 26:
--  * a customer message can use the channel 'bell' (the shop's bell only, no WhatsApp or email): staff who choose
--    "bell only" when changing a status still notify the customer in the shop
--  * an order with a payment proof can only go back to Awaiting payment by rejecting the proof (with a reason)
-- Safe to run more than once. Run after migration 25.
do $$
declare d text; d0 text; e text; e0 text;
begin
  d0 := pg_get_functiondef('public.admin_patch_order_core(text,jsonb)'::regprocedure); d := d0;
  d := replace(d, $q$(m ->> 'channel') in ('whatsapp','email')$q$, $q$(m ->> 'channel') in ('whatsapp','email','bell')$q$);
  if d = d0 and position($q$'whatsapp','email','bell'$q$ in d0) = 0 then raise exception 'core patch did not apply'; end if;
  execute d;
  e0 := pg_get_functiondef('public.admin_patch_order(text,jsonb)'::regprocedure); e := e0;
  if position('Reject the payment proof first' in e0) = 0 then
    e := regexp_replace(e, $q$(if cur = 'new' and st = 'awaiting' then\s+perform public\.bad\('[^']*'\); end if;)$q$,
      $q$\1
    if cur = 'review' and st = 'awaiting' and not (pt ? 'rejected') then
      perform public.bad('Reject the payment proof first. An order with a payment proof only goes back to Awaiting payment by rejecting the proof (with a reason).'); end if;$q$, 'n');
    if e = e0 then raise exception 'status rule patch did not apply'; end if;
    execute e;
  end if;
end $$;
