-- Provider national ID (Aadhaar etc.) required before admin can verify

create table if not exists public.provider_kyc (
  user_id uuid primary key references auth.users (id) on delete cascade,
  id_type text not null default 'aadhaar'
    check (id_type in ('aadhaar', 'pan', 'voter', 'passport', 'other')),
  id_number text not null,
  id_holder_name text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'rejected')),
  rejection_reason text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_kyc_status_idx on public.provider_kyc (status);

alter table public.provider_kyc enable row level security;

grant select, insert, update on table public.provider_kyc to authenticated;

drop policy if exists "Providers read own kyc; admins read all" on public.provider_kyc;
create policy "Providers read own kyc; admins read all"
  on public.provider_kyc
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "Providers insert own kyc" on public.provider_kyc;
create policy "Providers insert own kyc"
  on public.provider_kyc
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Providers update own kyc when not verified" on public.provider_kyc;
create policy "Providers update own kyc when not verified"
  on public.provider_kyc
  for update
  to authenticated
  using (
    (user_id = auth.uid() and status <> 'verified')
    or public.is_app_admin()
  )
  with check (
    (user_id = auth.uid() and status <> 'verified')
    or public.is_app_admin()
  );

-- Admin verify listing only if owner submitted national ID KYC
create or replace function public.set_provider_verified(p_provider_id uuid, p_verified boolean)
returns public.providers
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.providers;
  owner_id uuid;
  kyc_status text;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can verify providers';
  end if;

  select * into row from public.providers where id = p_provider_id for update;
  if not found then
    raise exception 'Provider not found';
  end if;

  owner_id := row.user_id;

  if p_verified then
    select k.status into kyc_status
    from public.provider_kyc k
    where k.user_id = owner_id;

    if kyc_status is null then
      raise exception 'Provider must submit national ID (Aadhaar) details before verification';
    end if;

    if kyc_status = 'rejected' then
      raise exception 'Provider KYC was rejected. Ask them to resubmit ID details first';
    end if;

    update public.providers
    set
      is_verified = true,
      verified_at = now()
    where id = p_provider_id
    returning * into row;

    update public.provider_kyc
    set
      status = 'verified',
      reviewed_at = now(),
      rejection_reason = '',
      updated_at = now()
    where user_id = owner_id;
  else
    update public.providers
    set
      is_verified = false,
      verified_at = null
    where id = p_provider_id
    returning * into row;

    -- Keep ID on file; move verified KYC back to submitted for re-review
    update public.provider_kyc
    set
      status = case when status = 'verified' then 'submitted' else status end,
      reviewed_at = now(),
      updated_at = now()
    where user_id = owner_id;
  end if;

  return row;
end;
$$;

create or replace function public.reject_provider_kyc(p_user_id uuid, p_reason text default '')
returns public.provider_kyc
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.provider_kyc;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can reject KYC';
  end if;

  update public.provider_kyc
  set
    status = 'rejected',
    rejection_reason = coalesce(p_reason, ''),
    reviewed_at = now(),
    updated_at = now()
  where user_id = p_user_id
  returning * into k;

  if not found then
    raise exception 'KYC not found';
  end if;

  update public.providers
  set is_verified = false, verified_at = null
  where user_id = p_user_id;

  return k;
end;
$$;

revoke all on function public.set_provider_verified(uuid, boolean) from public;
revoke all on function public.reject_provider_kyc(uuid, text) from public;
grant execute on function public.set_provider_verified(uuid, boolean) to authenticated;
grant execute on function public.reject_provider_kyc(uuid, text) to authenticated;
