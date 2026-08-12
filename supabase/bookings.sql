-- Run this in Supabase → SQL Editor after providers table exists
-- (Also included at the bottom of schema.sql for new setups)

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

-- Atomic accept: mark accepted and increment provider booking count
create or replace function public.accept_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
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

  return b;
end;
$$;

revoke all on function public.accept_booking(uuid) from public;
grant execute on function public.accept_booking(uuid) to authenticated;
