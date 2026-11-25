-- Growing Season: tablas de las cuentas de jugador en Supabase.
-- Se pega entero en el editor SQL de Supabase (SQL Editor → New query → Run).
-- Se puede volver a ejecutar sin problema: no borra datos.
--
-- profiles: el nombre de cada cuenta.
-- games:    una fila por partida online acabada (para partidas jugadas y % de victorias).
-- awards:   títulos y logros conseguidos (primera vez y cuántas veces).
-- Cada jugador solo puede leer y cambiar lo suyo (Row Level Security). Las partidas y los
-- premios solo se guardan con la función record_game, que no deja guardar dos veces la misma partida.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '' check (char_length(name) <= 16),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  user_id uuid not null references auth.users on delete cascade,
  game_id text not null check (char_length(game_id) <= 64),
  length text not null check (length in ('short', 'normal', 'long')),
  mode text not null check (mode in ('mine', 'fishing')),
  won boolean not null,
  played_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table if not exists public.awards (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('title', 'achievement')),
  award text not null check (char_length(award) <= 40),
  first_at timestamptz not null default now(),
  times integer not null default 1,
  primary key (user_id, kind, award)
);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.awards enable row level security;

drop policy if exists "own profile: read" on public.profiles;
drop policy if exists "own profile: create" on public.profiles;
drop policy if exists "own profile: update" on public.profiles;
drop policy if exists "own games: read" on public.games;
drop policy if exists "own awards: read" on public.awards;

create policy "own profile: read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile: create" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile: update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "own games: read" on public.games for select to authenticated using (user_id = auth.uid());
create policy "own awards: read" on public.awards for select to authenticated using (user_id = auth.uid());

-- Guarda el resultado de una partida y sus títulos y logros. Si esa partida ya estaba
-- guardada no hace nada. Devuelve los premios conseguidos por primera vez.
create or replace function public.record_game(
  p_game_id text, p_length text, p_mode text, p_won boolean,
  p_titles text[], p_achievements text[]
) returns table (new_kind text, new_award text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if coalesce(array_length(p_titles, 1), 0) > 20 or coalesce(array_length(p_achievements, 1), 0) > 20 then
    raise exception 'too many awards';
  end if;
  insert into games (user_id, game_id, length, mode, won)
    values (me, p_game_id, p_length, p_mode, p_won)
    on conflict do nothing;
  if not found then return; end if;
  return query
    with premios as (
      select distinct 'title'::text as k, unnest(coalesce(p_titles, '{}')) as a
      union
      select distinct 'achievement'::text, unnest(coalesce(p_achievements, '{}'))
    ), guardados as (
      insert into awards as aw (user_id, kind, award)
        select me, premios.k, premios.a from premios
        on conflict (user_id, kind, award) do update set times = aw.times + 1
        returning aw.kind, aw.award, (xmax = 0) as nuevo
    )
    select guardados.kind, guardados.award from guardados where guardados.nuevo;
end $$;

-- Borra la cuenta del jugador que la llama (y, en cascada, su perfil, partidas y premios)
create or replace function public.delete_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;

-- Permisos de las tablas (los proyectos nuevos de Supabase no los dan solos). Los visitantes sin
-- sesión (anon) no tienen ninguno; con sesión, las reglas de arriba limitan cada fila a su dueño.
revoke all on public.profiles, public.games, public.awards from anon;
grant select, insert, update on public.profiles to authenticated;
grant select on public.games, public.awards to authenticated;

revoke all on function public.record_game(text, text, text, boolean, text[], text[]) from public, anon;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.record_game(text, text, text, boolean, text[], text[]) to authenticated;
grant execute on function public.delete_account() to authenticated;
