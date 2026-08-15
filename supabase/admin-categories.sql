-- Dynamic service categories + simple admin allowlist

create table if not exists public.service_categories (
  id text primary key,
  name text not null unique,
  description text not null default '',
  icon text not null default 'wrench',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_categories_active_sort_idx
  on public.service_categories (is_active, sort_order, name);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.service_categories enable row level security;
alter table public.admin_users enable row level security;

grant select on table public.service_categories to anon, authenticated;
grant insert, update, delete on table public.service_categories to authenticated;
grant select on table public.admin_users to authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

drop policy if exists "Anyone can read active categories" on public.service_categories;
create policy "Anyone can read active categories"
  on public.service_categories
  for select
  to anon, authenticated
  using (is_active = true or public.is_app_admin());

drop policy if exists "Admins can insert categories" on public.service_categories;
create policy "Admins can insert categories"
  on public.service_categories
  for insert
  to authenticated
  with check (public.is_app_admin());

drop policy if exists "Admins can update categories" on public.service_categories;
create policy "Admins can update categories"
  on public.service_categories
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists "Admins can delete categories" on public.service_categories;
create policy "Admins can delete categories"
  on public.service_categories
  for delete
  to authenticated
  using (public.is_app_admin());

drop policy if exists "Users can see own admin row" on public.admin_users;
create policy "Users can see own admin row"
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- Seed default categories (safe to re-run)
insert into public.service_categories (id, name, description, icon, sort_order, is_active)
values
  ('plumbing', 'Plumbing', 'Leaks, fittings, drains', 'pipe', 10, true),
  ('electrical', 'Electrical', 'Wiring, switches, safety', 'bolt', 20, true),
  ('kitchen', 'Kitchen', 'Repairs & upgrades', 'kitchen', 30, true),
  ('appliances', 'Appliances', 'AC, fridge, washer, TV', 'appliance', 40, true),
  ('cleaning', 'Cleaning', 'Home deep cleans', 'sparkle', 50, true),
  ('painting', 'Painting', 'Interior & exterior', 'paint', 60, true),
  ('carpentry', 'Carpentry', 'Furniture & fittings', 'hammer', 70, true),
  ('pest', 'Pest control', 'Safe home treatment', 'shield', 80, true),
  ('purifier', 'Water purifier', 'Install & service', 'droplet', 90, true),
  ('chimney', 'Gas & chimney', 'Stove & hood care', 'flame', 100, true),
  ('maintenance', 'Maintenance', 'Indoor & outdoor', 'wrench', 110, true),
  ('gardening', 'Gardening', 'Lawn & plant care', 'leaf', 120, true),
  ('cctv', 'CCTV & security', 'Install & monitor', 'camera', 130, true),
  ('internet', 'Wi‑Fi setup', 'Routers & networks', 'wifi', 140, true),
  ('moving', 'Moving', 'Pack & shift', 'truck', 150, true),
  ('laundry', 'Laundry', 'Wash & fold', 'shirt', 160, true),
  ('beauty', 'Beauty at home', 'Wellness visits', 'spa', 170, true),
  ('care', 'Care services', 'Babysitting & elders', 'heart', 180, true),
  ('tuition', 'Home tuition', 'Teaching at home', 'book', 190, true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

-- Promote all current auth users as admins (small project bootstrap; trim later if needed)
insert into public.admin_users (user_id)
select id from auth.users
on conflict (user_id) do nothing;
