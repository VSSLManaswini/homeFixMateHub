-- Run this in Supabase → SQL Editor → New query → Run

create extension if not exists "pgcrypto";

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  service text not null,
  quote text not null,
  contact text not null,
  bookings integer not null default 0 check (bookings >= 0),
  rating numeric(2,1) not null default 4.5 check (rating >= 0 and rating <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  availability_status text not null default 'available'
    check (availability_status in ('available', 'busy')),
  preferred_hours text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists providers_created_at_idx on public.providers (created_at desc);
create index if not exists providers_user_id_idx on public.providers (user_id);

alter table public.providers enable row level security;

grant usage on schema public to anon, authenticated;
grant select on table public.providers to anon, authenticated;
grant insert, update, delete on table public.providers to authenticated;

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

-- Bookings (same as bookings.sql)
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'completed', 'cancelled')),
  booking_type text not null default 'instant'
    check (booking_type in ('instant', 'scheduled')),
  scheduled_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint scheduled_requires_time check (
    (booking_type = 'instant' and scheduled_at is null)
    or (booking_type = 'scheduled' and scheduled_at is not null)
  )
);

create index if not exists bookings_provider_id_idx on public.bookings (provider_id);
create index if not exists bookings_customer_id_idx on public.bookings (customer_id);
create index if not exists bookings_created_at_idx on public.bookings (created_at desc);

alter table public.bookings enable row level security;

drop policy if exists "Customers and providers can read bookings" on public.bookings;
create policy "Customers and providers can read bookings"
  on public.bookings
  for select
  to authenticated
  using (
    customer_id = auth.uid()
    or exists (
      select 1
      from public.providers p
      where p.id = provider_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "Customers can create bookings" on public.bookings;
create policy "Customers can create bookings"
  on public.bookings
  for insert
  to authenticated
  with check (customer_id = auth.uid());

drop policy if exists "Customers and providers can update bookings" on public.bookings;
create policy "Customers and providers can update bookings"
  on public.bookings
  for update
  to authenticated
  using (
    customer_id = auth.uid()
    or exists (
      select 1
      from public.providers p
      where p.id = provider_id and p.user_id = auth.uid()
    )
  )
  with check (
    customer_id = auth.uid()
    or exists (
      select 1
      from public.providers p
      where p.id = provider_id and p.user_id = auth.uid()
    )
  );

create or replace function public.accept_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  provider_name text;
  provider_service text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if not exists (
    select 1 from public.providers
    where id = b.provider_id and user_id = auth.uid()
  ) then
    raise exception 'Not allowed to accept this booking';
  end if;

  if b.status <> 'pending' then
    raise exception 'Only pending bookings can be accepted';
  end if;

  update public.bookings
  set status = 'accepted'
  where id = p_booking_id
  returning * into b;

  update public.providers
  set bookings = bookings + 1
  where id = b.provider_id;

  select p.name, p.service into provider_name, provider_service
  from public.providers p
  where p.id = b.provider_id;

  insert into public.notifications (user_id, type, title, body, booking_id)
  values (
    b.customer_id,
    'booking_accepted',
    'Booking accepted',
    coalesce(provider_name, 'Provider') ||
      ' accepted your ' ||
      coalesce(provider_service, 'service') ||
      ' request. Pay 10% to HomeFix to unlock the provider phone number and confirm the job.',
    b.id
  );

  return b;
end;
$$;

revoke all on function public.accept_booking(uuid) from public;
grant execute on function public.accept_booking(uuid) to authenticated;
