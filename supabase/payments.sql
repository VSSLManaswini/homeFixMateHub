-- HomeFix marketplace escrow:
-- 1) Customer pays 10% deposit to HomeFix after accept
-- 2) Provider marks work completed
-- 3) Customer pays remaining 90% to HomeFix
-- 4) HomeFix pays provider their 90% share (payout)

alter table public.bookings
  add column if not exists quote_amount numeric(12,2) not null default 0,
  add column if not exists platform_fee_amount numeric(12,2) not null default 0,
  add column if not exists deposit_amount numeric(12,2) not null default 0,
  add column if not exists remaining_amount numeric(12,2) not null default 0,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payout_status text not null default 'not_due';

-- Relax/recreate payment_status check safely
alter table public.bookings drop constraint if exists bookings_payment_status_check;
alter table public.bookings
  add constraint bookings_payment_status_check
  check (payment_status in ('unpaid', 'deposit_paid', 'fully_paid'));

alter table public.bookings drop constraint if exists bookings_payout_status_check;
alter table public.bookings
  add constraint bookings_payout_status_check
  check (payout_status in ('not_due', 'pending', 'paid'));

comment on column public.bookings.platform_fee_amount is 'HomeFix keeps 10%';
comment on column public.bookings.deposit_amount is 'Customer pays 10% to HomeFix after accept';
comment on column public.bookings.remaining_amount is 'Customer pays 90% to HomeFix after completion';
comment on column public.bookings.payout_status is 'HomeFix paying provider 90%: not_due | pending | paid';

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
  set payment_status = 'deposit_paid'
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

-- Customer pays final 90% to HomeFix; then HomeFix releases provider payout (90%)
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
  if b.status <> 'completed' then raise exception 'Final payment is only due after the service is completed'; end if;
  if b.payment_status <> 'deposit_paid' then raise exception 'Pay the 10%% deposit first'; end if;

  update public.bookings
  set
    payment_status = 'fully_paid',
    payout_status = 'paid'
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.pay_booking_deposit(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from public;
grant execute on function public.pay_booking_deposit(uuid) to authenticated;
grant execute on function public.pay_booking_remaining(uuid) to authenticated;
