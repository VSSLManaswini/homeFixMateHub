-- Razorpay payment tracking on bookings + service-role apply helper.
-- Edge Functions verify the customer / webhook signature, then call
-- apply_razorpay_booking_payment (service_role only). Existing
-- pay_booking_deposit / pay_booking_remaining remain for authenticated clients
-- (e.g. VITE_MOCK_PAYMENTS=true).

alter table public.bookings
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_deposit_payment_id text,
  add column if not exists razorpay_remaining_payment_id text,
  add column if not exists razorpay_payment_link_id text,
  add column if not exists razorpay_payment_link_url text;

comment on column public.bookings.razorpay_order_id is 'Latest Razorpay order id for deposit or remaining checkout';
comment on column public.bookings.razorpay_deposit_payment_id is 'Razorpay payment id for 10% deposit';
comment on column public.bookings.razorpay_remaining_payment_id is 'Razorpay payment id for remaining 90%';
comment on column public.bookings.razorpay_payment_link_id is 'Latest Razorpay payment link id for deposit or remaining';
comment on column public.bookings.razorpay_payment_link_url is 'Latest Razorpay payment link short URL shown to the customer';

-- Mark booking paid after Razorpay verification (Edge Function / webhook).
-- Idempotent: if already paid for that kind, stores payment id if missing and returns.
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
      razorpay_order_id = coalesce(razorpay_order_id, nullif(trim(p_razorpay_order_id), ''))
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
    payout_status = 'paid',
    remaining_paid_at = coalesce(remaining_paid_at, now()),
    razorpay_order_id = coalesce(nullif(trim(p_razorpay_order_id), ''), razorpay_order_id),
    razorpay_remaining_payment_id = p_razorpay_payment_id
  where id = p_booking_id
  returning * into b;

  return b;
end;
$$;

revoke all on function public.apply_razorpay_booking_payment(uuid, text, text, text) from public;
grant execute on function public.apply_razorpay_booking_payment(uuid, text, text, text) to service_role;
