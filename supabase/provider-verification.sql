-- Provider verification badges (admin-only toggle)

alter table public.providers
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz;

comment on column public.providers.is_verified is 'HomeFix admin verified this provider listing';
comment on column public.providers.verified_at is 'When the listing was last verified';

create or replace function public.set_provider_verified(p_provider_id uuid, p_verified boolean)
returns public.providers
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.providers;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can verify providers';
  end if;

  update public.providers
  set
    is_verified = p_verified,
    verified_at = case when p_verified then now() else null end
  where id = p_provider_id
  returning * into row;

  if not found then
    raise exception 'Provider not found';
  end if;

  return row;
end;
$$;

revoke all on function public.set_provider_verified(uuid, boolean) from public;
grant execute on function public.set_provider_verified(uuid, boolean) to authenticated;
