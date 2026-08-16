-- Provider listing availability (available / busy) + preferred hours note

alter table public.providers
  add column if not exists availability_status text not null default 'available',
  add column if not exists preferred_hours text not null default '';

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'providers'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%availability_status%';

  if constraint_name is not null then
    execute format('alter table public.providers drop constraint %I', constraint_name);
  end if;

  alter table public.providers
    add constraint providers_availability_status_check
    check (availability_status in ('available', 'busy'));
end $$;

comment on column public.providers.availability_status is
  'Provider-set status for this listing: available or busy';
comment on column public.providers.preferred_hours is
  'Freeform preferred hours note, e.g. Mon–Sat 9am–6pm';

-- Owners can already update their own provider rows (see schema / fix-provider-visibility).
-- Re-assert the update policy so availability fields stay editable by the listing owner.
drop policy if exists "Users can update own providers" on public.providers;
create policy "Users can update own providers"
  on public.providers
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
