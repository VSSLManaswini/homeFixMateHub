-- Restrict admin access to the platform owner only
-- Re-run safely anytime

delete from public.admin_users;

insert into public.admin_users (user_id)
select id from auth.users
where lower(email) = lower('suryalakshmimanaswini@gmail.com')
on conflict (user_id) do nothing;
