-- Run once in the trusted Supabase SQL Editor AFTER subscriptions.sql.
-- The administrator must already have signed up with this exact email.
do $$ declare admin_id uuid; begin
  select id into admin_id from auth.users where lower(email)='ruelsabaduquia@gmail.com';
  if admin_id is null then raise exception 'First register ruelsabaduquia@gmail.com in the app, then run this SQL again.'; end if;
  insert into public.mn_platform_admins(user_id) values(admin_id) on conflict do nothing;
end $$;
