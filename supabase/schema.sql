-- MTG Set Tracker — database schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: it uses "if not exists" / "or replace" and drops+recreates policies.

-- ============================================================
-- profiles: one row per user, created automatically on signup
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text,
  avatar_url   text,
  bio          text,
  is_public    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- username rules: 3-30 chars, lowercase letters/numbers/underscore/hyphen
alter table public.profiles
  drop constraint if exists username_format;
alter table public.profiles
  add constraint username_format check (username ~ '^[a-z0-9_-]{3,30}$');

-- ============================================================
-- collection: which cards a user owns, per finish
-- ============================================================
create table if not exists public.collection (
  user_id    uuid not null references auth.users(id) on delete cascade,
  card_id    text not null,            -- Scryfall card id
  set_code   text not null,            -- e.g. "hob"
  nonfoil    boolean not null default false,
  foil       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index if not exists collection_user_set_idx on public.collection (user_id, set_code);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles   enable row level security;
alter table public.collection enable row level security;

-- profiles: anyone can read a public profile; you can always read your own
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (is_public or auth.uid() = id);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete
  using (auth.uid() = id);

-- collection: read your own, or anyone whose profile is public (for public profile pages)
drop policy if exists collection_select on public.collection;
create policy collection_select on public.collection for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = collection.user_id and p.is_public
    )
  );

drop policy if exists collection_write on public.collection;
create policy collection_write on public.collection for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Auto-create a profile row when a new auth user signs up.
-- Username defaults to the email local-part, sanitised, with a short
-- random suffix to avoid collisions; the user can change it later.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidate text;
begin
  base := lower(regexp_replace(split_part(coalesce(new.email, 'player'), '@', 1), '[^a-z0-9_-]', '', 'g'));
  if length(base) < 3 then base := 'player'; end if;
  base := left(base, 24);
  candidate := base || '-' || substr(md5(random()::text), 1, 5);
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, initcap(split_part(coalesce(new.email, 'Player'), '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Allow a signed-in user to delete their own account (and, via
-- cascade, their profile + collection). Callable from the client
-- via rpc('delete_own_account').
-- ============================================================
create or replace function public.delete_own_account()
returns void
language sql
security definer set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- keep updated_at fresh on writes
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists collection_touch on public.collection;
create trigger collection_touch before update on public.collection
  for each row execute function public.touch_updated_at();

-- ============================================================
-- decks: user-built decks, shareable by public link
-- ============================================================
create table if not exists public.decks (
  id          text primary key,           -- short random slug used in the share URL
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Untitled deck',
  format      text,
  description text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists decks_user_idx on public.decks(user_id);

create table if not exists public.deck_cards (
  deck_id  text not null references public.decks(id) on delete cascade,
  card_id  text not null,                 -- Scryfall card id
  name     text not null,
  set_code text,
  image    text,                          -- small image url for display
  usd      numeric,                       -- unit price snapshot (for deck value)
  qty      int not null default 1,
  board    text not null default 'main',  -- main | side | commander
  primary key (deck_id, card_id, board)
);

alter table public.decks      enable row level security;
alter table public.deck_cards enable row level security;

drop policy if exists decks_select on public.decks;
create policy decks_select on public.decks for select
  using (is_public or auth.uid() = user_id);
drop policy if exists decks_write on public.decks;
create policy decks_write on public.decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- deck_cards readable when the parent deck is readable; writable when it's owned
drop policy if exists deck_cards_select on public.deck_cards;
create policy deck_cards_select on public.deck_cards for select using (
  exists (select 1 from public.decks d
          where d.id = deck_cards.deck_id and (d.is_public or d.user_id = auth.uid()))
);
drop policy if exists deck_cards_write on public.deck_cards;
create policy deck_cards_write on public.deck_cards for all using (
  exists (select 1 from public.decks d where d.id = deck_cards.deck_id and d.user_id = auth.uid())
) with check (
  exists (select 1 from public.decks d where d.id = deck_cards.deck_id and d.user_id = auth.uid())
);

drop trigger if exists decks_touch on public.decks;
create trigger decks_touch before update on public.decks
  for each row execute function public.touch_updated_at();

-- ============================================================
-- prices: Card Kingdom retail prices, keyed by Scryfall card id.
-- Populated by the scheduled ingestion job (scripts/ingest-ck-prices.mjs)
-- using the service_role key; read-only for everyone else.
-- ============================================================
create table if not exists public.prices (
  card_id    text primary key,     -- Scryfall card id
  ck_normal  numeric,              -- Card Kingdom retail, non-foil (USD)
  ck_foil    numeric,              -- Card Kingdom retail, foil (USD)
  updated_at timestamptz not null default now()
);

alter table public.prices enable row level security;
drop policy if exists prices_select on public.prices;
create policy prices_select on public.prices for select using (true);
-- no insert/update/delete policy: only service_role (which bypasses RLS) writes

-- bulk lookup by a list of card ids (avoids long GET URLs)
create or replace function public.prices_for(ids text[])
returns setof public.prices language sql stable security invoker
as $$ select * from public.prices where card_id = any(ids) $$;
revoke all on function public.prices_for(text[]) from public;
grant execute on function public.prices_for(text[]) to anon, authenticated;
