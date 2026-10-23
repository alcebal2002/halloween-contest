-- Run after 001 and 002, for both new and existing installations.
-- Historical rows keep NULL: their GFT IDs cannot be inferred.
begin;

alter table public.contest_results
  add column gft_id text
  constraint contest_results_gft_id_format check (gft_id ~ '^[A-Za-z0-9]{4}$');
alter table public.nicknames
  add column gft_id text
  constraint nicknames_gft_id_format check (gft_id ~ '^[A-Za-z0-9]{4}$');

-- NOT VALID preserves historical rows but requires an ID on every new write.
alter table public.contest_results
  add constraint contest_results_gft_id_required check (gft_id is not null) not valid;
alter table public.nicknames
  add constraint nicknames_gft_id_required check (gft_id is not null) not valid;

-- Supabase may hold the old uniqueness as a constraint or as a plain index.
alter table public.nicknames drop constraint if exists nicknames_lower_unique;
drop index if exists public.nicknames_lower_unique;
create unique index nicknames_lower_unique on public.nicknames (nickname_lower, lower(gft_id));

commit;
