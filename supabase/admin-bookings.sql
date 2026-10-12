-- Admin can list all bookings (operations view).

drop function if exists public.list_admin_bookings(integer);

create or replace function public.list_admin_bookings(p_limit integer default 80)
returns table (
  booking_id uuid,
  provider_id uuid,
  provider_name text,
  customer_id uuid,
  status text,
  booking_type text,
  scheduled_at timestamptz,
  payment_status text,
  payout_status text,
  quote_amount numeric,
  job_address text,
  refund_requested boolean,
  refund_handled_at timestamptz,
  work_started_at timestamptz,
  customer_completed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can list all bookings';
  end if;

  return query
  select
    b.id,
    b.provider_id,
    coalesce(p.name, 'Listing') as provider_name,
    b.customer_id,
    b.status,
    b.booking_type,
    b.scheduled_at,
    b.payment_status,
    b.payout_status,
    b.quote_amount,
    b.job_address,
    b.refund_requested,
    b.refund_handled_at,
    b.work_started_at,
    b.customer_completed,
    b.created_at
  from public.bookings b
  left join public.providers p on p.id = b.provider_id
  order by b.refund_requested desc, b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 80), 200));
end;
$$;

revoke all on function public.list_admin_bookings(integer) from public;
grant execute on function public.list_admin_bookings(integer) to authenticated;
