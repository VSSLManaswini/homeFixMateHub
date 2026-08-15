-- Payment history timestamps for invoice-style ledger

alter table public.bookings
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists remaining_paid_at timestamptz;

comment on column public.bookings.deposit_paid_at is 'When customer paid 10% to HomeFix';
comment on column public.bookings.remaining_paid_at is 'When customer paid remaining 90% to HomeFix (credited to provider)';

create or replace function public.pay_booking_deposit(p_booking_id uuid)
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
  if b.status <> 'accepted' then raise exception 'Deposit is only due after the provider accepts'; end if;
  if b.payment_status <> 'unpaid' then raise exception 'Deposit already paid'; end if;

  update public.bookings
  set
    payment_status = 'deposit_paid',
    deposit_paid_at = coalesce(deposit_paid_at, now())
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
    payout_status = 'paid',
    remaining_paid_at = coalesce(remaining_paid_at, now())
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

-- Best-effort backfill for older paid bookings
update public.bookings
set deposit_paid_at = coalesce(deposit_paid_at, created_at)
where payment_status in ('deposit_paid', 'fully_paid')
  and deposit_paid_at is null;

update public.bookings
set remaining_paid_at = coalesce(remaining_paid_at, created_at)
where payment_status = 'fully_paid'
  and remaining_paid_at is null;

revoke all on function public.pay_booking_deposit(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from public;
grant execute on function public.pay_booking_deposit(uuid) to authenticated;
grant execute on function public.pay_booking_remaining(uuid) to authenticated;
