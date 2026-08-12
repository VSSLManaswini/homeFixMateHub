-- Fix: allow every visitor/user to READ provider listings
-- Run once in Supabase → SQL Editor

-- Table privileges (common missing piece)
grant usage on schema public to anon, authenticated;
grant select on table public.providers to anon, authenticated;
grant insert, update, delete on table public.providers to authenticated;

-- Ensure bookings grants exist too (safe if table already created)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'bookings'
  ) then
    execute 'grant select, insert, update on table public.bookings to authenticated';
    execute 'grant execute on function public.accept_booking(uuid) to authenticated';
  end if;
end $$;

alter table public.providers enable row level security;

-- Recreate open read policy for everyone
drop policy if exists "Anyone can read providers" on public.providers;
create policy "Anyone can read providers"
  on public.providers
  for select
  to anon, authenticated
  using (true);

-- Keep write policies scoped to the owning user
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
