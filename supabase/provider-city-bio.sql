-- Listing city and short bio for browse (no GPS).

alter table public.providers
  add column if not exists city text not null default '',
  add column if not exists bio text not null default '';

comment on column public.providers.city is 'Service city / area shown on browse';
comment on column public.providers.bio is 'Short public listing description';
