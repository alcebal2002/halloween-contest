-- Table of nicknames that have been used at least once, so the Start screen can
-- tell a returning player that a name is already taken. The owner runs this once
-- in the Supabase SQL editor; it is committed so the schema can be rebuilt
-- identically from the repository alone.
--
-- Requirements it enforces:
--   * nickname_lower is generated from nickname, so uniqueness is
--     case-insensitive: "Bat", "bat" and "BAT" are the same name.
--   * the unique index on nickname_lower is what makes the client's insert-first
--     check work — a second use of a name fails with Postgres 23505 (HTTP 409)
--     instead of inserting a duplicate.
--   * row-level security allows insert and select only. There is deliberately no
--     update and no delete policy, so the set of names can only grow and no row
--     can be changed or removed through the API.

create table public.nicknames (
  id             bigint generated always as identity primary key,
  nickname       text not null check (char_length(nickname) between 1 and 20),
  nickname_lower text generated always as (lower(nickname)) stored,
  created_at     timestamptz not null default now()
);

create unique index nicknames_lower_unique on public.nicknames (nickname_lower);

grant select, insert on public.nicknames to anon, authenticated;

alter table public.nicknames enable row level security;

create policy "anyone may claim a nickname"
  on public.nicknames for insert to anon, authenticated
  with check (true);

create policy "anyone may read nicknames"
  on public.nicknames for select to anon, authenticated
  using (true);
