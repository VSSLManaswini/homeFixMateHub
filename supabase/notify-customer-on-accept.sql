-- Notify customer when provider accepts; ensure contacts unlock messaging after 10% deposit

-- Allow booking_accepted notification type
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('booking_request', 'booking_update', 'booking_accepted'));

-- Accept booking + notify the customer to pay 10% (unlocks contacts)
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
