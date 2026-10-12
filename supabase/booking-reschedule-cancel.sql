-- Reschedule scheduled jobs; cancel with refund flag after money is with HomeFix.

alter table public.bookings
  add column if not exists refund_requested boolean not null default false,
  add column if not exists refund_handled_at timestamptz;

comment on column public.bookings.refund_requested is
  'Customer cancelled after paying HomeFix; admin refunds in Razorpay Dashboard then marks handled';

create or replace function public.reschedule_booking(p_booking_id uuid, p_scheduled_at timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  provider_owner uuid;
begin
  if p_scheduled_at is null or p_scheduled_at < now() then
    raise exception 'Pick a future date and time';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.customer_id <> auth.uid() then raise exception 'Not allowed'; end if;
  if b.booking_type <> 'scheduled' then raise exception 'Only scheduled bookings can be rescheduled'; end if;
  if b.status not in ('pending', 'accepted') then raise exception 'This booking cannot be rescheduled'; end if;
  if b.payment_status = 'fully_paid' then raise exception 'Fully paid jobs cannot be rescheduled here'; end if;
  if b.customer_completed or b.provider_completed then
    raise exception 'Job already in completion — contact HomeFix support';
  end if;

  update public.bookings
  set scheduled_at = p_scheduled_at
  where id = p_booking_id
  returning * into b;

  select p.user_id into provider_owner from public.providers p where p.id = b.provider_id;
  if provider_owner is not null then
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      provider_owner,
      'booking_update',
      'Booking rescheduled',
      'The customer picked a new date/time. Open Bookings to review.',
      b.id
    );
  end if;

  return b;
end;
$$;

create or replace function public.cancel_customer_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  need_refund boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.customer_id <> auth.uid() then raise exception 'Not allowed'; end if;
  if b.status in ('cancelled', 'rejected', 'completed') then
    raise exception 'This booking cannot be cancelled';
  end if;
  if b.customer_completed and b.provider_completed then
    raise exception 'Both sides already confirmed the job. Pay remaining or contact support.';
  end if;

  need_refund := b.payment_status in ('deposit_paid', 'fully_paid');

  update public.bookings
  set
    status = 'cancelled',
    refund_requested = refund_requested or need_refund
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

create or replace function public.mark_booking_refund_handled(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can mark refunds handled';
  end if;

  update public.bookings
  set refund_handled_at = now()
  where id = p_booking_id
  returning * into b;

  if not found then raise exception 'Booking not found'; end if;
  return b;
end;
$$;

revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
revoke all on function public.cancel_customer_booking(uuid) from public;
revoke all on function public.mark_booking_refund_handled(uuid) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_customer_booking(uuid) to authenticated;
grant execute on function public.mark_booking_refund_handled(uuid) to authenticated;
