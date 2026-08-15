-- Run in Supabase SQL Editor (reviews + rating updates)

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  rating numeric(2,1) not null check (rating >= 1 and rating <= 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reviews_provider_id_idx on public.reviews (provider_id);
create index if not exists reviews_customer_id_idx on public.reviews (customer_id);

alter table public.reviews enable row level security;

grant select on table public.reviews to anon, authenticated;
grant insert on table public.reviews to authenticated;

drop policy if exists "Anyone can read reviews" on public.reviews;
create policy "Anyone can read reviews"
  on public.reviews
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Customers can insert own reviews" on public.reviews;
create policy "Customers can insert own reviews"
  on public.reviews
  for insert
  to authenticated
  with check (customer_id = auth.uid());

-- Customer leaves a review on a completed booking; provider rating is recalculated
create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating numeric,
  p_comment text default ''
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  r public.reviews;
  avg_rating numeric;
  cnt integer;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if b.customer_id <> auth.uid() then
    raise exception 'Not allowed to review this booking';
  end if;

  if b.status <> 'completed' then
    raise exception 'Only completed bookings can be reviewed';
  end if;

  if b.payment_status is distinct from 'fully_paid' then
    raise exception 'Finish the final 90%% payment before reviewing';
  end if;

  if exists (select 1 from public.reviews where booking_id = p_booking_id) then
    raise exception 'This booking was already reviewed';
  end if;

  insert into public.reviews (booking_id, provider_id, customer_id, rating, comment)
  values (p_booking_id, b.provider_id, auth.uid(), p_rating, coalesce(p_comment, ''))
  returning * into r;

  select coalesce(avg(rating), 4.5), count(*)::int
    into avg_rating, cnt
  from public.reviews
  where provider_id = b.provider_id;

  update public.providers
  set rating = round(avg_rating::numeric, 1),
      rating_count = cnt
  where id = b.provider_id;

  return r;
end;
$$;

revoke all on function public.submit_review(uuid, numeric, text) from public;
grant execute on function public.submit_review(uuid, numeric, text) to authenticated;
