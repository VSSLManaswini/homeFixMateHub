-- Admin snapshot of HomeFix 10% fees and payout pipeline.

create or replace function public.get_admin_platform_summary()
returns table (
  bookings_total bigint,
  fully_paid_count bigint,
  deposit_paid_open bigint,
  platform_fees_collected numeric,
  payouts_pending_amount numeric,
  payouts_paid_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can view platform summary';
  end if;

  return query
  select
    count(*)::bigint as bookings_total,
    count(*) filter (where b.payment_status = 'fully_paid')::bigint as fully_paid_count,
    count(*) filter (where b.payment_status = 'deposit_paid')::bigint as deposit_paid_open,
    coalesce(sum(b.platform_fee_amount) filter (
      where b.payment_status in ('deposit_paid', 'fully_paid')
    ), 0) as platform_fees_collected,
    coalesce(sum(b.remaining_amount) filter (
      where b.payment_status = 'fully_paid' and b.payout_status in ('pending', 'failed')
    ), 0) as payouts_pending_amount,
    coalesce(sum(b.remaining_amount) filter (
      where b.payment_status = 'fully_paid' and b.payout_status = 'paid'
    ), 0) as payouts_paid_amount
  from public.bookings b;
end;
$$;

revoke all on function public.get_admin_platform_summary() from public;
grant execute on function public.get_admin_platform_summary() to authenticated;
