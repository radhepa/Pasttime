-- Applied 2026-10-14. Pastime crash reports: written only when the app fails to start or crashes.
-- Insert-only for everyone; nobody can read them through the API (read them in the SQL editor).
create table if not exists public.pastime_client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  message text not null check (char_length(message) <= 4000),
  user_agent text check (char_length(user_agent) <= 500),
  url text check (char_length(url) <= 300),
  build text check (char_length(build) <= 100)
);
alter table public.pastime_client_errors enable row level security;
drop policy if exists "pastime errors: anyone can report" on public.pastime_client_errors;
create policy "pastime errors: anyone can report" on public.pastime_client_errors for insert to anon, authenticated with check (true);
revoke all on public.pastime_client_errors from anon, authenticated;
grant insert (message, user_agent, url, build) on public.pastime_client_errors to anon, authenticated;
