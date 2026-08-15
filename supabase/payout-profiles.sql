-- Provider payout profile (UPI / bank) — private to the provider user
-- HomeFix will use this later for real 90% payouts

create table if not exists public.provider_payout_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payout_method text not null default 'upi'
    check (payout_method in ('upi', 'bank')),
  upi_id text not null default '',
  account_holder_name text not null default '',
  bank_name text not null default '',
  account_number text not null default '',
  ifsc text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.provider_payout_profiles enable row level security;

grant select, insert, update on table public.provider_payout_profiles to authenticated;

drop policy if exists "Providers can read own payout profile" on public.provider_payout_profiles;
create policy "Providers can read own payout profile"
  on public.provider_payout_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Providers can insert own payout profile" on public.provider_payout_profiles;
create policy "Providers can insert own payout profile"
  on public.provider_payout_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Providers can update own payout profile" on public.provider_payout_profiles;
create policy "Providers can update own payout profile"
  on public.provider_payout_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.provider_payout_profiles is 'Private payout destination for HomeFix to credit providers 90% after full customer payment';
