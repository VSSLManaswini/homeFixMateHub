-- Provider payouts (RazorpayX): after customer pays remaining 90%,
-- queue a real payout to the provider's UPI/bank. HomeFix keeps 10%.
-- Demo "payout_status = paid" on remaining payment is removed.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists razorpay_payout_id text,
  add column if not exists payout_error text,
  add column if not exists payout_at timestamptz;

alter table public.bookings drop constraint if exists bookings_payout_status_check;
alter table public.bookings
  add constraint bookings_payout_status_check
  check (payout_status in ('not_due', 'pending', 'paid', 'failed'));

comment on column public.bookings.payout_status is
  'HomeFix → provider 90%: not_due | pending | paid | failed';
comment on column public.bookings.razorpay_payout_id is 'RazorpayX payout id once created';
comment on column public.bookings.payout_error is 'Last payout failure or blocked reason';
comment on column public.bookings.payout_at is 'When RazorpayX payout was accepted / marked paid';

create index if not exists bookings_payout_status_idx
  on public.bookings (payout_status)
  where payout_status in ('pending', 'failed');

-- Dual-complete should NOT mark payout pending — only remaining payment does.
create or replace function public.confirm_job_complete(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  is_provider boolean;
  is_customer boolean;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  is_customer := (b.customer_id = auth.uid());
  is_provider := exists (
    select 1 from public.providers
    where id = b.provider_id and user_id = auth.uid()
  );

  if not is_customer and not is_provider then
    raise exception 'Not allowed';
  end if;

  if b.status not in ('accepted', 'completed') then
    raise exception 'Job can only be confirmed after the booking is accepted';
  end if;

  if b.payment_status = 'unpaid' then
    raise exception 'Customer must pay the 10%% deposit to HomeFix before confirming completion';
  end if;

  if is_provider then
    update public.bookings
    set provider_completed = true
    where id = p_booking_id
    returning * into b;
  end if;

  if is_customer then
    update public.bookings
    set customer_completed = true
    where id = p_booking_id
    returning * into b;
  end if;

  if b.provider_completed and b.customer_completed and b.status = 'accepted' then
    update public.bookings
    set status = 'completed'
    where id = p_booking_id
    returning * into b;
  end if;

  return b;
end;
$$;

revoke all on function public.confirm_job_complete(uuid) from public;
grant execute on function public.confirm_job_complete(uuid) to authenticated;

-- Remaining 90% paid → queue provider payout (do not mark paid here).
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
  if not (b.provider_completed and b.customer_completed) then
    raise exception 'Both provider and customer must confirm the job is completed first';
  end if;
  if b.status <> 'completed' then
    raise exception 'Final payment is only due after both sides confirm completion';
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

revoke all on function public.pay_booking_remaining(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from authenticated;
grant execute on function public.pay_booking_remaining(uuid) to service_role;

-- Razorpay verify/webhook apply path: remaining → payout pending (not paid).
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

    update public.bookings
    set
      payment_status = 'deposit_paid',
      deposit_paid_at = coalesce(deposit_paid_at, now()),
      razorpay_order_id = coalesce(nullif(trim(p_razorpay_order_id), ''), razorpay_order_id),
      razorpay_deposit_payment_id = p_razorpay_payment_id
    where id = p_booking_id
    returning * into b;

    return b;
  end if;

  -- remaining
  if b.payment_status = 'fully_paid' then
    update public.bookings
    set
      razorpay_remaining_payment_id = coalesce(razorpay_remaining_payment_id, p_razorpay_payment_id),
      razorpay_order_id = coalesce(razorpay_order_id, nullif(trim(p_razorpay_order_id), '')),
      -- Ensure demo "paid" rows get re-queued if no real payout id yet
      payout_status = case
        when razorpay_payout_id is null or length(trim(coalesce(razorpay_payout_id, ''))) = 0
          then case when payout_status = 'paid' then 'pending' else payout_status end
        else payout_status
      end
    where id = p_booking_id
    returning * into b;
    return b;
  end if;

  if not (b.provider_completed and b.customer_completed) then
    raise exception 'Both provider and customer must confirm the job is completed first';
  end if;
  if b.status <> 'completed' then
    raise exception 'Final payment is only due after both sides confirm completion';
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

revoke all on function public.apply_razorpay_booking_payment(uuid, text, text, text) from public;
grant execute on function public.apply_razorpay_booking_payment(uuid, text, text, text) to service_role;

-- Mark payout result (Edge Function / service_role only).
create or replace function public.mark_booking_payout_result(
  p_booking_id uuid,
  p_status text,
  p_razorpay_payout_id text default null,
  p_error text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if p_status not in ('pending', 'paid', 'failed') then
    raise exception 'Invalid payout status';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if b.payment_status <> 'fully_paid' then
    raise exception 'Payout only after booking is fully paid';
  end if;

  -- Idempotent success
  if b.payout_status = 'paid' and b.razorpay_payout_id is not null then
    return b;
  end if;

  if p_status = 'paid' then
    if p_razorpay_payout_id is null or length(trim(p_razorpay_payout_id)) = 0 then
      raise exception 'Missing Razorpay payout id';
    end if;
    update public.bookings
    set
      payout_status = 'paid',
      razorpay_payout_id = trim(p_razorpay_payout_id),
      payout_error = null,
      payout_at = coalesce(payout_at, now())
    where id = p_booking_id
    returning * into b;
    return b;
  end if;

  if p_status = 'failed' then
    update public.bookings
    set
      payout_status = 'failed',
      payout_error = left(coalesce(nullif(trim(p_error), ''), 'Payout failed'), 500)
    where id = p_booking_id
    returning * into b;
    return b;
  end if;

  -- pending (re-queue / clear error)
  update public.bookings
  set
    payout_status = 'pending',
    payout_error = nullif(trim(coalesce(p_error, '')), '')
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.mark_booking_payout_result(uuid, text, text, text) from public;
grant execute on function public.mark_booking_payout_result(uuid, text, text, text) to service_role;

-- Admin: queue / retry a payout (sets pending; Edge Function executes).
create or replace function public.queue_booking_payout(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can queue payouts';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.payment_status <> 'fully_paid' then
    raise exception 'Booking must be fully paid before payout';
  end if;
  if b.payout_status = 'paid' and b.razorpay_payout_id is not null then
    return b;
  end if;

  update public.bookings
  set
    payout_status = 'pending',
    payout_error = null
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.queue_booking_payout(uuid) from public;
grant execute on function public.queue_booking_payout(uuid) to authenticated;

-- Admin: list pending / failed payouts for the dashboard.
drop function if exists public.list_booking_payouts(int);

create or replace function public.list_booking_payouts(p_limit int default 50)
returns table (
  booking_id uuid,
  provider_id uuid,
  provider_name text,
  provider_user_id uuid,
  remaining_amount numeric,
  payment_status text,
  payout_status text,
  payout_error text,
  razorpay_payout_id text,
  remaining_paid_at timestamptz,
  payout_at timestamptz,
  created_at timestamptz,
  payout_destination text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can list payouts';
  end if;

  return query
  select
    b.id as booking_id,
    b.provider_id,
    coalesce(p.name, 'Provider') as provider_name,
    p.user_id as provider_user_id,
    b.remaining_amount,
    b.payment_status,
    b.payout_status,
    b.payout_error,
    b.razorpay_payout_id,
    b.remaining_paid_at,
    b.payout_at,
    b.created_at,
    case
      when pp.user_id is null then 'No payout profile saved'
      when pp.payout_method = 'upi' then
        concat('UPI · ', coalesce(nullif(trim(pp.upi_id), ''), '—'), ' · ', coalesce(nullif(trim(pp.account_holder_name), ''), '—'))
      else
        concat(
          coalesce(nullif(trim(pp.bank_name), ''), 'Bank'),
          ' · ****',
          right(regexp_replace(coalesce(pp.account_number, ''), '\s', '', 'g'), 4),
          ' · ',
          coalesce(nullif(trim(pp.ifsc), ''), '—'),
          ' · ',
          coalesce(nullif(trim(pp.account_holder_name), ''), '—')
        )
    end as payout_destination
  from public.bookings b
  left join public.providers p on p.id = b.provider_id
  left join public.provider_payout_profiles pp on pp.user_id = p.user_id
  where b.payment_status = 'fully_paid'
    and b.payout_status in ('pending', 'failed', 'paid')
  order by
    case b.payout_status when 'failed' then 0 when 'pending' then 1 else 2 end,
    coalesce(b.remaining_paid_at, b.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.list_booking_payouts(int) from public;
grant execute on function public.list_booking_payouts(int) to authenticated;

-- Path B: individual Razorpay accounts cannot use RazorpayX. Admin records a manual UPI/bank transfer.
create or replace function public.mark_booking_payout_manual_paid(p_booking_id uuid, p_note text default '')
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  note text;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can mark a manual payout';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;
  if b.payment_status <> 'fully_paid' then
    raise exception 'Booking must be fully paid before marking a payout';
  end if;
  if b.payout_status = 'paid' then
    return b;
  end if;
  if b.payout_status not in ('pending', 'failed') then
    raise exception 'Payout is not due yet';
  end if;

  note := left(nullif(trim(coalesce(p_note, '')), ''), 400);
  if note is null then
    note := 'manual: transferred outside RazorpayX';
  elsif note not ilike 'manual:%' then
    note := 'manual: ' || note;
  end if;

  update public.bookings
  set
    payout_status = 'paid',
    razorpay_payout_id = coalesce(nullif(trim(razorpay_payout_id), ''), 'manual'),
    payout_error = note,
    payout_at = coalesce(payout_at, now())
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.mark_booking_payout_manual_paid(uuid, text) from public;
grant execute on function public.mark_booking_payout_manual_paid(uuid, text) to authenticated;

-- Backfill: stop treating demo "paid" as real; re-queue when no payout id.
update public.bookings
set
  payout_status = 'pending',
  payout_error = coalesce(
    nullif(trim(payout_error), ''),
    'Re-queued: previous status was demo paid without RazorpayX payout id'
  )
where payment_status = 'fully_paid'
  and payout_status = 'paid'
  and (razorpay_payout_id is null or length(trim(razorpay_payout_id)) = 0);

-- Premature pending before full payment → not due.
update public.bookings
set payout_status = 'not_due',
    payout_error = null
where payment_status <> 'fully_paid'
  and payout_status in ('pending', 'failed');
