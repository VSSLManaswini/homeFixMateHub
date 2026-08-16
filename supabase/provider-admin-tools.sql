-- Admin provider tools: deactivate listings + booking stats
-- Requires: public.providers, public.bookings, public.is_app_admin()

alter table public.providers
  add column if not exists is_active boolean not null default true;

comment on column public.providers.is_active is
  'When false, listing is hidden from customer browse (admin deactivate)';

create index if not exists providers_is_active_idx on public.providers (is_active);

-- Hide inactive listings from customers; owners and admins still see them
drop policy if exists "Anyone can read providers" on public.providers;
create policy "Anyone can read providers"
  on public.providers
  for select
  to anon, authenticated
  using (
    is_active = true
    or auth.uid() = user_id
    or public.is_app_admin()
  );

create or replace function public.set_provider_active(p_provider_id uuid, p_active boolean)
returns public.providers
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.providers;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can activate or deactivate providers';
  end if;

  update public.providers
  set is_active = p_active
  where id = p_provider_id
  returning * into row;

  if not found then
    raise exception 'Provider not found';
  end if;

  return row;
end;
$$;

revoke all on function public.set_provider_active(uuid, boolean) from public;
grant execute on function public.set_provider_active(uuid, boolean) to authenticated;

create or replace function public.get_provider_booking_stats()
returns table (
  provider_id uuid,
  total bigint,
  pending bigint,
  accepted bigint,
  completed bigint,
  rejected bigint,
  cancelled bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can view provider booking stats';
  end if;

  return query
  select
    p.id as provider_id,
    count(b.id)::bigint as total,
    count(*) filter (where b.status = 'pending')::bigint as pending,
    count(*) filter (where b.status = 'accepted')::bigint as accepted,
    count(*) filter (where b.status = 'completed')::bigint as completed,
    count(*) filter (where b.status = 'rejected')::bigint as rejected,
    count(*) filter (where b.status = 'cancelled')::bigint as cancelled
  from public.providers p
  left join public.bookings b on b.provider_id = p.id
  group by p.id;
end;
$$;

revoke all on function public.get_provider_booking_stats() from public;
grant execute on function public.get_provider_booking_stats() to authenticated;
