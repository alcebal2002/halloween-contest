-- Table for finished Halloween Contest results.
-- The owner runs this once in the Supabase SQL editor; it is committed so the
-- schema can be rebuilt identically from the repository alone.
--
-- Requirements it enforces:
--   * session_id is the primary key, so a repeated submission is rejected by the
--     database (Postgres 23505 -> HTTP 409) rather than overwriting anything.
--   * row-level security allows insert and select only. There is deliberately no
--     update and no delete policy, so no row can ever be changed through the API.

create table public.contest_results (
  session_id      text primary key,
  nickname        text not null check (char_length(nickname) between 1 and 24),
  total_score     integer not null check (total_score >= 0),
  correct_count   integer not null check (correct_count >= 0),
  bonuses_matched integer not null check (bonuses_matched >= 0),
  elapsed_ms      integer not null check (elapsed_ms >= 0),
  finished_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint bonuses_within_correctes check (bonuses_matched <= correct_count)
);

grant select, insert on public.contest_results to anon, authenticated;

alter table public.contest_results enable row level security;

create policy "anyone may submit a result"
  on public.contest_results for insert to anon, authenticated
  with check (true);

create policy "anyone may read results"
  on public.contest_results for select to anon, authenticated
  using (true);
