-- In-app notifications for reject / cancel / both-sides complete (no email).

create or replace function public.notify_on_booking_status()
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
  if old.status is not distinct from new.status then
    return new;
  end if;

  select p.user_id, p.name
  into provider_owner, provider_name
  from public.providers p
  where p.id = new.provider_id;

  if new.status = 'rejected' and old.status = 'pending' then
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      new.customer_id,
      'booking_update',
      'Booking declined',
      coalesce(provider_name, 'The provider') || ' declined your request. You can book another listing.',
      new.id
    );
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      new.customer_id,
      'booking_update',
      'Booking cancelled',
      'This HomeFix booking was cancelled.',
      new.id
    );
    if provider_owner is not null then
      insert into public.notifications (user_id, type, title, body, booking_id)
      values (
        provider_owner,
        'booking_update',
        'Booking cancelled',
        coalesce(provider_name, 'A listing') || ' — this booking was cancelled.',
        new.id
      );
    end if;
  end if;

  if new.status = 'completed' and old.status = 'accepted' then
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (
      new.customer_id,
      'booking_update',
      'Job confirmed complete',
      'Both sides confirmed the work. Pay the remaining 90% to HomeFix when ready.',
      new.id
    );
    if provider_owner is not null then
      insert into public.notifications (user_id, type, title, body, booking_id)
      values (
        provider_owner,
        'booking_update',
        'Job confirmed complete',
        'Waiting for the customer’s remaining 90% payment to HomeFix.',
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_notify_status on public.bookings;
create trigger bookings_notify_status
  after update of status on public.bookings
  for each row
  execute function public.notify_on_booking_status();
