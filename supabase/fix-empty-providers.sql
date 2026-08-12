-- Run in Supabase SQL Editor (safe while providers table is empty)

grant usage on schema public to anon, authenticated, service_role;

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  service text not null,
  quote text not null,
  contact text not null,
  bookings integer not null default 0 check (bookings >= 0),
  created_at timestamptz not null default now()
);

create index if not exists providers_created_at_idx on public.providers (created_at desc);
create index if not exists providers_user_id_idx on public.providers (user_id);

alter table public.providers enable row level security;
alter table public.providers force row level security;

grant select on table public.providers to anon, authenticated, service_role;
grant insert, update, delete on table public.providers to authenticated, service_role;

drop policy if exists "Anyone can read providers" on public.providers;
create policy "Anyone can read providers"
  on public.providers
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can insert own providers" on public.providers;
create policy "Users can insert own providers"
  on public.providers
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own providers" on public.providers;
create policy "Users can update own providers"
  on public.providers
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own providers" on public.providers;
create policy "Users can delete own providers"
  on public.providers
  for delete
  to authenticated
  using (auth.uid() = user_id);
