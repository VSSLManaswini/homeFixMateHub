-- Job site address collected at booking. Shown to the provider after the 10% deposit.

alter table public.bookings
  add column if not exists job_address text not null default '';

comment on column public.bookings.job_address is 'Service location; provider UI shows it after deposit, same as phone';
