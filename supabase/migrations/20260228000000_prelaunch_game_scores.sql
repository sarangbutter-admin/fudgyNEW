-- Delidome migration 59: top 5 scores per level for the pre-launch mini game "Catch the cookies".
--  * game_tops(): the top 5 of every level (name, icon, score), for everyone
--  * game_submit(): a player who reached the top 5 saves their name. The score can't be above the level's highest possible
--    score (game.max in the published pre-launch settings), and one connection can send only a few scores per hour.
--  * admin_game_clear(): the owner empties one level (or all levels when p_lv is null)
-- Safe to run more than once.

create table if not exists public.game_scores (
  id    bigserial primary key,
  lv    smallint not null,
  name  text not null,
  av    smallint not null default 0,
  score integer not null,
  at    bigint not null
);
create index if not exists game_scores_lv_idx on public.game_scores (lv, score desc, at);
alter table public.game_scores enable row level security;
revoke all on public.game_scores from anon, authenticated;

create or replace function public.game_tops() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(lv, rows), '{}'::jsonb) from (
    select lv, jsonb_agg(jsonb_build_object('name', name, 'av', av, 'score', score) order by score desc, at) rows
    from (select s.*, row_number() over (partition by lv order by score desc, at) rn from public.game_scores s) x
    where rn <= 5 group by lv) y $$;

create or replace function public.game_submit(p_lv int, p_score int, p_name text, p_av int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mx numeric; nm text; t bigint := public.now_ms(); fifth int; n int;
begin
  if p_lv is null or p_lv < 1 or p_lv > 10 then perform public.bad('Unknown level.'); end if;
  if p_score is null or p_score < 1 then perform public.bad('No score to save.'); end if;
  begin mx := (select (data -> 'game' -> 'max' ->> (p_lv - 1))::numeric from public.docs where key = 'prelaunch'); exception when others then mx := null; end;
  if p_score > coalesce(mx, 100000000) then perform public.bad('That score is higher than this level allows.'); end if;
  nm := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g')), 20);
  if nm = '' then perform public.bad('Type your name.'); end if;
  if not public.throttle_ip('game-h', 20, 3600000) then perform public.bad('Too many scores from this connection. Please try again later.'); end if;
  select count(*), min(score) into n, fifth from (select score from public.game_scores where lv = p_lv order by score desc, at limit 5) z;
  if n >= 5 and p_score <= fifth then perform public.bad('This score is not in the top 5 any more.'); end if;
  insert into public.game_scores (lv, name, av, score, at) values (p_lv, nm, greatest(0, least(coalesce(p_av, 0), 9)), p_score, t);
  -- keep the table small: only the best 20 of each level
  delete from public.game_scores where lv = p_lv and id not in (select id from public.game_scores where lv = p_lv order by score desc, at limit 20);
  return public.game_tops();
end $$;

create or replace function public.admin_game_clear(p_lv int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  if p_lv is null then delete from public.game_scores; else delete from public.game_scores where lv = p_lv; end if;
  perform public.log_act('Mini game scores cleared', case when p_lv is null then 'all levels' else 'level ' || p_lv end);
  return public.game_tops();
end $$;

revoke all on function public.game_tops(), public.game_submit(int, int, text, int), public.admin_game_clear(int) from public;
grant execute on function public.game_tops(), public.game_submit(int, int, text, int) to anon, authenticated;
grant execute on function public.admin_game_clear(int) to authenticated;
