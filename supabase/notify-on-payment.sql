-- In-app notifications when a booking payment status changes (no Resend / email).

create or replace function public.notify_on_booking_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_owner uuid;
  provider_name text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.payment_status is not distinct from new.payment_status then
    return new;
  end if;

  select p.user_id, p.name
  into provider_owner, provider_name
  from public.providers p
  where p.id = new.provider_id;

  if new.payment_status = 'deposit_paid' and old.payment_status = 'unpaid' then
    if provider_owner is not null then
      insert into public.notifications (user_id, type, title, body, booking_id)
      values (
        provider_owner,
        'booking_update',
        '10% deposit paid',
        coalesce(provider_name, 'Your listing') ||
          ' — customer paid the HomeFix deposit. Contacts are unlocked.',
        new.id
      );
    end if;
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      new.customer_id,
      'booking_update',
      'Deposit recorded',
      'Your 10% payment to HomeFix is confirmed. Provider contact is unlocked.',
      new.id
    );
  end if;

  if new.payment_status = 'fully_paid' and old.payment_status is distinct from 'fully_paid' then
    if provider_owner is not null then
      insert into public.notifications (user_id, type, title, body, booking_id)
      values (
        provider_owner,
        'booking_update',
        '90% received by HomeFix',
        coalesce(provider_name, 'Your listing') ||
          ' — customer paid the remaining amount. Your payout is pending.',
        new.id
      );
    end if;
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      new.customer_id,
      'booking_update',
      'Payment complete',
      'Your remaining 90% payment to HomeFix is confirmed.',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_notify_payment on public.bookings;
create trigger bookings_notify_payment
  after update of payment_status on public.bookings
  for each row
  execute function public.notify_on_booking_payment();
