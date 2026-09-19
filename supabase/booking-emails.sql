-- Transactional booking email log (idempotency for Resend)

create table if not exists public.booking_email_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  event text not null,
  recipient text not null,
  sent_at timestamptz not null default now()
);

create unique index if not exists booking_email_log_unique_idx
  on public.booking_email_log (booking_id, event, recipient);

alter table public.booking_email_log enable row level security;

-- Service role (edge function) bypasses RLS. No authenticated policies on purpose.
