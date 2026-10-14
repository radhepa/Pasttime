-- Applied to the Supabase project on 2026-10-14. Safe to re-run.
-- Pastime sync: one row per local IndexedDB record, private to its owner.
create table if not exists public.pastime_rows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tbl text not null check (tbl in ('media', 'episodes', 'logs', 'lists', 'categories', 'settings')),
  id text not null check (char_length(id) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, tbl, id)
);

create index if not exists pastime_rows_user_updated on public.pastime_rows (user_id, updated_at);

-- The server stamps every write, so "give me what changed since X" works across devices with different clocks.
create or replace function public.pastime_rows_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists pastime_rows_stamp on public.pastime_rows;
create trigger pastime_rows_stamp before insert or update on public.pastime_rows
for each row execute function public.pastime_rows_stamp();

alter table public.pastime_rows enable row level security;

drop policy if exists "pastime: read own" on public.pastime_rows;
drop policy if exists "pastime: insert own" on public.pastime_rows;
drop policy if exists "pastime: update own" on public.pastime_rows;
drop policy if exists "pastime: delete own" on public.pastime_rows;
create policy "pastime: read own" on public.pastime_rows for select to authenticated using (user_id = (select auth.uid()));
create policy "pastime: insert own" on public.pastime_rows for insert to authenticated with check (user_id = (select auth.uid()));
create policy "pastime: update own" on public.pastime_rows for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "pastime: delete own" on public.pastime_rows for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.pastime_rows from anon;
grant select, insert, update, delete on public.pastime_rows to authenticated;

-- Live updates between devices (Realtime respects the RLS policies above).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pastime_rows') then
    alter publication supabase_realtime add table public.pastime_rows;
  end if;
end $$;
