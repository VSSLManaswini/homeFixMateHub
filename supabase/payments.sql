-- Marketplace payments: HomeFix holds funds; 10% deposit then 90% after completion
-- Run in Supabase SQL Editor

alter table public.bookings
  add column if not exists quote_amount numeric(12,2) not null default 0,
  add column if not exists platform_fee_amount numeric(12,2) not null default 0,
  add column if not exists deposit_amount numeric(12,2) not null default 0,
  add column if not exists remaining_amount numeric(12,2) not null default 0,
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'deposit_paid', 'fully_paid'));

comment on column public.bookings.platform_fee_amount is 'HomeFix 10% commission (deposit)';
comment on column public.bookings.deposit_amount is 'Customer pays this after accept (10%) to HomeFix';
comment on column public.bookings.remaining_amount is 'Customer pays this after service completed (90%)';

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
  set payment_status = 'fully_paid'
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.pay_booking_deposit(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from public;
grant execute on function public.pay_booking_deposit(uuid) to authenticated;
grant execute on function public.pay_booking_remaining(uuid) to authenticated;
