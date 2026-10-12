-- Ola/Rapido-style start OTP: customer shows a 4-digit code, provider enters it to start.
-- Customer then marks the job completed; remaining 90% is due after that.

alter table public.bookings
  add column if not exists start_otp text not null default '',
  add column if not exists work_started_at timestamptz;

comment on column public.bookings.start_otp is '4-digit start code shown only to the customer via RPC';
comment on column public.bookings.work_started_at is 'When the provider entered the customer start OTP';

create or replace function public._homefix_new_start_otp()
returns text
language sql
as $$
  select lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

create or replace function public.get_my_job_start_otps()
returns table (
  booking_id uuid,
  start_otp text,
  work_started boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set start_otp = public._homefix_new_start_otp()
  where customer_id = auth.uid()
    and payment_status in ('deposit_paid', 'fully_paid')
    and status = 'accepted'
    and work_started_at is null
    and start_otp !~ '^[0-9]{4}$';

  return query
  select
    b.id,
    case
      when b.work_started_at is not null then ''
      else b.start_otp
    end,
    (b.work_started_at is not null)
  from public.bookings b
  where b.customer_id = auth.uid()
    and b.payment_status in ('deposit_paid', 'fully_paid')
    and b.status in ('accepted', 'completed');
end;
$$;

-- Ensure a code exists once the 10% deposit is paid (also backfills older jobs).
create or replace function public.ensure_booking_start_otp(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  code text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.customer_id <> auth.uid() then raise exception 'Not allowed'; end if;
  if b.payment_status = 'unpaid' then
    raise exception 'Pay the 10%% deposit first — then you get a start OTP to share';
  end if;
  if b.work_started_at is not null then
    return '';
  end if;
  if b.start_otp ~ '^[0-9]{4}$' then
    return b.start_otp;
  end if;

  code := public._homefix_new_start_otp();
  update public.bookings set start_otp = code where id = p_booking_id;
  return code;
end;
$$;

create or replace function public.start_job_with_otp(p_booking_id uuid, p_otp text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  code text;
begin
  code := regexp_replace(coalesce(p_otp, ''), '\D', '', 'g');
  if length(code) <> 4 then
    raise exception 'Enter the 4-digit code from the customer';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if not exists (
    select 1 from public.providers p
    where p.id = b.provider_id and p.user_id = auth.uid()
  ) then
    raise exception 'Only the assigned provider can start this job';
  end if;

  if b.status <> 'accepted' then
    raise exception 'Job can only be started after you accept and the customer pays 10%%';
  end if;
  if b.payment_status = 'unpaid' then
    raise exception 'Customer must pay the 10%% deposit first';
  end if;
  if b.work_started_at is not null then
    return b;
  end if;
  if b.start_otp is null or b.start_otp = '' or b.start_otp <> code then
    raise exception 'Wrong OTP. Ask the customer for the 4-digit start code.';
  end if;

  update public.bookings
  set
    work_started_at = now(),
    start_otp = ''
  where id = p_booking_id
  returning * into b;

  insert into public.notifications (user_id, type, title, body, booking_id)
  values (
    b.customer_id,
    'booking_update',
    'Work started',
    'The provider entered your OTP and started the job. When they finish, tap Job completed.',
    b.id
  );

  return b;
end;
$$;

-- Customer marks the task done after OTP start (remaining 90% becomes due).
create or replace function public.confirm_job_complete(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if b.customer_id <> auth.uid() then
    raise exception 'Only the customer can mark the job completed';
  end if;

  if b.status not in ('accepted', 'completed') then
    raise exception 'Job can only be completed after it is accepted';
  end if;

  if b.payment_status = 'unpaid' then
    raise exception 'Pay the 10%% deposit first';
  end if;

  if b.work_started_at is null and not b.provider_completed then
    raise exception 'The provider must enter your start OTP before you can mark the job completed';
  end if;

  update public.bookings
  set
    customer_completed = true,
    provider_completed = true,
    status = case when status = 'accepted' then 'completed' else status end
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

create or replace function public.apply_razorpay_booking_payment(
  p_booking_id uuid,
  p_kind text,
  p_razorpay_order_id text,
  p_razorpay_payment_id text
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  code text;
begin
  if p_kind not in ('deposit', 'remaining') then
    raise exception 'Invalid payment kind';
  end if;
  if p_razorpay_payment_id is null or length(trim(p_razorpay_payment_id)) = 0 then
    raise exception 'Missing Razorpay payment id';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if p_kind = 'deposit' then
    if b.payment_status in ('deposit_paid', 'fully_paid') then
      update public.bookings
      set
        razorpay_deposit_payment_id = coalesce(razorpay_deposit_payment_id, p_razorpay_payment_id),
        razorpay_order_id = coalesce(razorpay_order_id, nullif(trim(p_razorpay_order_id), ''))
      where id = p_booking_id
      returning * into b;
      return b;
    end if;

    if b.status <> 'accepted' then
      raise exception 'Deposit is only due after the provider accepts';
    end if;
    if b.payment_status <> 'unpaid' then
      raise exception 'Deposit already paid';
    end if;

    code := public._homefix_new_start_otp();

    update public.bookings
    set
      payment_status = 'deposit_paid',
      deposit_paid_at = coalesce(deposit_paid_at, now()),
      razorpay_order_id = coalesce(nullif(trim(p_razorpay_order_id), ''), razorpay_order_id),
      razorpay_deposit_payment_id = p_razorpay_payment_id,
      start_otp = case when start_otp ~ '^[0-9]{4}$' then start_otp else code end
    where id = p_booking_id
    returning * into b;

    return b;
  end if;

  if b.payment_status = 'fully_paid' then
    update public.bookings
    set
      razorpay_remaining_payment_id = coalesce(razorpay_remaining_payment_id, p_razorpay_payment_id),
      razorpay_order_id = coalesce(razorpay_order_id, nullif(trim(p_razorpay_order_id), ''))
    where id = p_booking_id
    returning * into b;
    return b;
  end if;

  if b.status <> 'completed' then
    raise exception 'Final payment is only due after the customer marks the job completed';
  end if;
  if b.payment_status <> 'deposit_paid' then
    raise exception 'Pay the 10%% deposit first';
  end if;

  update public.bookings
  set
    payment_status = 'fully_paid',
    payout_status = 'pending',
    remaining_paid_at = coalesce(remaining_paid_at, now()),
    payout_error = null,
    razorpay_order_id = coalesce(nullif(trim(p_razorpay_order_id), ''), razorpay_order_id),
    razorpay_remaining_payment_id = p_razorpay_payment_id
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

create or replace function public.pay_booking_remaining(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.customer_id <> auth.uid() then raise exception 'Not allowed'; end if;
  if b.status <> 'completed' then
    raise exception 'Final payment is only due after you mark the job completed';
  end if;
  if b.payment_status <> 'deposit_paid' then raise exception 'Pay the 10%% deposit first'; end if;

  update public.bookings
  set
    payment_status = 'fully_paid',
    payout_status = 'pending',
    remaining_paid_at = coalesce(remaining_paid_at, now()),
    payout_error = null
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

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
  if b.work_started_at is not null or b.customer_completed or b.provider_completed then
    raise exception 'Job already started — contact HomeFix support';
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

revoke all on function public._homefix_new_start_otp() from public;
revoke all on function public.get_my_job_start_otps() from public;
revoke all on function public.ensure_booking_start_otp(uuid) from public;
revoke all on function public.start_job_with_otp(uuid, text) from public;
revoke all on function public.confirm_job_complete(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from public;
revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
revoke all on function public.apply_razorpay_booking_payment(uuid, text, text, text) from public;

grant execute on function public.get_my_job_start_otps() to authenticated;
grant execute on function public.ensure_booking_start_otp(uuid) to authenticated;
grant execute on function public.start_job_with_otp(uuid, text) to authenticated;
grant execute on function public.confirm_job_complete(uuid) to authenticated;
grant execute on function public.pay_booking_remaining(uuid) to authenticated;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;
grant execute on function public.apply_razorpay_booking_payment(uuid, text, text, text) to service_role;
