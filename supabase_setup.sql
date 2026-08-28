-- Travel Explorer - struttura di sincronizzazione Michele / Denise
-- Eseguire una sola volta nel SQL Editor di Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.shared_state (
  trip_id uuid not null references public.trips(id) on delete cascade,
  store_key text not null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  device_id text,
  primary key (trip_id, store_key)
);

create index if not exists shared_state_updated_at_idx
  on public.shared_state (trip_id, updated_at);

-- Crea automaticamente il profilo quando nasce un utente Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'utente'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Recupera eventuali utenti creati prima di questo script.
insert into public.profiles (id, display_name)
select
  id,
  coalesce(
    nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
    split_part(coalesce(email, 'utente'), '@', 1)
  )
from auth.users
on conflict (id) do nothing;

-- Funzioni interne usate dalle regole RLS.
create or replace function public.is_trip_member(
  p_trip_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = p_trip_id
      and user_id = p_user_id
  );
$$;

create or replace function public.shares_trip_with(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members mine
    join public.trip_members theirs
      on theirs.trip_id = mine.trip_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user
  );
$$;

-- Crea il viaggio e restituisce il codice da comunicare a Denise.
create or replace function public.create_shared_trip(
  p_name text default 'Mauritius 2026'
)
returns table (trip_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    exit when not exists (
      select 1 from public.trips where trips.invite_code = v_code
    );
  end loop;

  insert into public.trips (name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Mauritius 2026'), v_code, auth.uid())
  returning id into v_trip_id;

  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip_id, auth.uid(), 'owner');

  return query select v_trip_id, v_code;
end;
$$;

-- Denise entra nel viaggio usando il codice generato da Michele.
create or replace function public.join_shared_trip(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into v_trip_id
  from public.trips
  where invite_code = upper(trim(p_invite_code));

  if v_trip_id is null then
    raise exception 'INVITE_CODE_INVALID';
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip_id, auth.uid(), 'member')
  on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;

-- Scrive un modulo dell'app controllando che nessuno lo abbia già aggiornato.
create or replace function public.write_shared_state(
  p_trip_id uuid,
  p_store_key text,
  p_payload jsonb,
  p_expected_revision bigint default 0,
  p_device_id text default null
)
returns public.shared_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.shared_state%rowtype;
  v_result public.shared_state%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_trip_member(p_trip_id, auth.uid()) then
    raise exception 'TRIP_ACCESS_DENIED';
  end if;

  if nullif(trim(p_store_key), '') is null then
    raise exception 'STORE_KEY_REQUIRED';
  end if;

  select * into v_current
  from public.shared_state
  where trip_id = p_trip_id and store_key = p_store_key
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'SYNC_CONFLICT' using errcode = '40001';
    end if;

    insert into public.shared_state (
      trip_id, store_key, payload, revision, updated_at, updated_by, device_id
    ) values (
      p_trip_id, trim(p_store_key), coalesce(p_payload, 'null'::jsonb),
      1, now(), auth.uid(), nullif(trim(p_device_id), '')
    )
    returning * into v_result;
  else
    if v_current.revision <> coalesce(p_expected_revision, 0) then
      raise exception 'SYNC_CONFLICT' using errcode = '40001';
    end if;

    update public.shared_state
    set payload = coalesce(p_payload, 'null'::jsonb),
        revision = v_current.revision + 1,
        updated_at = now(),
        updated_by = auth.uid(),
        device_id = nullif(trim(p_device_id), '')
    where trip_id = p_trip_id and store_key = p_store_key
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

-- Sicurezza a livello di riga.
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.shared_state enable row level security;

drop policy if exists profiles_select_shared on public.profiles;
create policy profiles_select_shared
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists trips_select_member on public.trips;
create policy trips_select_member
  on public.trips for select
  to authenticated
  using (public.is_trip_member(id));

drop policy if exists trip_members_select_member on public.trip_members;
create policy trip_members_select_member
  on public.trip_members for select
  to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists shared_state_select_member on public.shared_state;
create policy shared_state_select_member
  on public.shared_state for select
  to authenticated
  using (public.is_trip_member(trip_id));

-- Espone solo ciò che serve al browser.
revoke all on public.profiles, public.trips, public.trip_members, public.shared_state
  from anon, authenticated;
grant select on public.profiles, public.trips, public.trip_members, public.shared_state
  to authenticated;
grant update (display_name) on public.profiles to authenticated;

revoke all on function public.create_shared_trip(text) from public, anon;
revoke all on function public.join_shared_trip(text) from public, anon;
revoke all on function public.write_shared_state(uuid, text, jsonb, bigint, text)
  from public, anon;
grant execute on function public.create_shared_trip(text) to authenticated;
grant execute on function public.join_shared_trip(text) to authenticated;
grant execute on function public.write_shared_state(uuid, text, jsonb, bigint, text)
  to authenticated;

-- Abilita gli aggiornamenti realtime per i due iPhone.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_state'
  ) then
    alter publication supabase_realtime add table public.shared_state;
  end if;
end;
$$;
