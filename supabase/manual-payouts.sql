-- Path B: admin marks 90% paid after a manual UPI/bank transfer (no RazorpayX).

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
