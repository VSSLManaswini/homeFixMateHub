-- Favorites: receivers can save providers for quick access
-- Run in Supabase SQL Editor (also applied via script when available)

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, provider_id)
);

create index if not exists favorites_user_id_idx on public.favorites (user_id);
create index if not exists favorites_provider_id_idx on public.favorites (provider_id);

alter table public.favorites enable row level security;

grant select, insert, delete on table public.favorites to authenticated;

drop policy if exists "Users can read own favorites" on public.favorites;
create policy "Users can read own favorites"
  on public.favorites
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own favorites" on public.favorites;
create policy "Users can insert own favorites"
  on public.favorites
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own favorites" on public.favorites;
create policy "Users can delete own favorites"
  on public.favorites
  for delete
  to authenticated
  using (user_id = auth.uid());
