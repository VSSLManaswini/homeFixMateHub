-- HomeFix flow:
-- 1) Provider accepts
-- 2) Customer pays 10% to HomeFix
-- 3) Contacts unlock for both sides
-- 4) Provider AND customer both mark work done → status completed
-- 5) Customer pays remaining 90% to HomeFix → credited to provider (payout paid)

alter table public.bookings
  add column if not exists customer_contact text not null default '',
  add column if not exists provider_completed boolean not null default false,
  add column if not exists customer_completed boolean not null default false;

comment on column public.bookings.customer_contact is 'Customer phone shared with provider only after 10% deposit';
comment on column public.bookings.provider_completed is 'Provider confirmed job finished';
comment on column public.bookings.customer_completed is 'Customer confirmed job finished';

-- Either party confirms completion; booking becomes completed only when both have confirmed
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
    set
      status = 'completed',
      payout_status = case when payout_status = 'not_due' then 'pending' else payout_status end
    where id = p_booking_id
    returning * into b;
  end if;

  return b;
end;
$$;

-- Final 90% only after both sides confirmed (status completed)
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
    payout_status = 'paid'
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.confirm_job_complete(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from public;
grant execute on function public.confirm_job_complete(uuid) to authenticated;
grant execute on function public.pay_booking_remaining(uuid) to authenticated;
