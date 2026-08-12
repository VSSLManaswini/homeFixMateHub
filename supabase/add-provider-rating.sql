-- Run in Supabase SQL Editor (step 2: browse filters need rating)

alter table public.providers
  add column if not exists rating numeric(2,1) not null default 4.5
    check (rating >= 0 and rating <= 5);

alter table public.providers
  add column if not exists rating_count integer not null default 0
    check (rating_count >= 0);

-- Give existing demo rows a visible rating
update public.providers
set rating = 4.7, rating_count = greatest(bookings, 1)
where rating_count = 0;
