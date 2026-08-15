-- In-app notifications for providers (new booking requests)
-- Run in Supabase SQL Editor

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null default 'booking_request'
    check (type in ('booking_request', 'booking_update', 'booking_accepted')),
  title text not null,
  body text not null default '',
  booking_id uuid references public.bookings (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index if not exists notifications_booking_id_idx on public.notifications (booking_id);

alter table public.notifications enable row level security;

grant select, update on table public.notifications to authenticated;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Notify the provider owner when a customer creates a booking
create or replace function public.notify_provider_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_owner uuid;
  provider_name text;
  provider_service text;
begin
  select p.user_id, p.name, p.service
  into provider_owner, provider_name, provider_service
  from public.providers p
  where p.id = new.provider_id;

  if provider_owner is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, booking_id)
  values (
    provider_owner,
    'booking_request',
    'New booking request',
    coalesce(provider_name, 'Your listing') ||
      ' · ' ||
      coalesce(provider_service, 'Service') ||
      ' · ' ||
      case when new.booking_type = 'scheduled' then 'Scheduled' else 'Instant' end ||
      ' — open Bookings to accept or reject.',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists bookings_notify_provider on public.bookings;
create trigger bookings_notify_provider
  after insert on public.bookings
  for each row
  execute function public.notify_provider_on_booking();

-- Realtime so the provider dashboard updates while open
do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
