-- Run LAST, after tutor_work_ownership.sql. Existing families keep no-expiry access.
begin;
create table if not exists public.mn_platform_admins(user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.mn_billing_settings(
  id boolean primary key default true check(id),
  gcash_number text not null default '09995063999', account_name text not null default '',
  instructions text not null default 'Send payment to the GCash number above, then submit the reference number. Activation follows manual verification.',
  monthly_price numeric(12,2) not null default 0 check(monthly_price>=0),
  quarterly_price numeric(12,2) not null default 0 check(quarterly_price>=0),
  annual_price numeric(12,2) not null default 0 check(annual_price>=0)
);
insert into public.mn_billing_settings(id) values(true) on conflict do nothing;
create table if not exists public.mn_subscriptions(
  family_id uuid primary key references public.mn_families(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','active','suspended')),
  plan text not null default 'monthly' check(plan in ('monthly','quarterly','annual','no_expiry','custom')),
  expires_at timestamptz, message text not null default '', updated_at timestamptz not null default now(),
  check(status<>'active' or expires_at is not null or plan='no_expiry')
);
insert into public.mn_subscriptions(family_id,status,plan) select id,'active','no_expiry' from public.mn_families on conflict do nothing;
create table if not exists public.mn_subscription_payments(
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.mn_families(id) on delete cascade,
  submitted_by uuid not null references auth.users(id), plan text not null check(plan in ('monthly','quarterly','annual')),
  reference text not null unique check(length(reference) between 6 and 64), amount numeric(12,2) not null check(amount>0),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  admin_note text not null default '', created_at timestamptz not null default now(), decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create unique index if not exists mn_one_pending_payment on public.mn_subscription_payments(family_id) where status='pending';
create table if not exists public.mn_billing_events(
  id uuid primary key default gen_random_uuid(), family_id uuid references public.mn_families(id) on delete set null,
  actor_id uuid references auth.users(id), event text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.mn_platform_admins enable row level security;
alter table public.mn_billing_settings enable row level security;
alter table public.mn_subscriptions enable row level security;
alter table public.mn_subscription_payments enable row level security;
alter table public.mn_billing_events enable row level security;
revoke all on public.mn_platform_admins,public.mn_billing_settings,public.mn_subscriptions,public.mn_subscription_payments,public.mn_billing_events from anon,authenticated;

create or replace function public.mn_is_platform_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(select 1 from public.mn_platform_admins where user_id=auth.uid());
$$;
create or replace function public.mn_subscription_active(p_family_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.mn_subscriptions where family_id=p_family_id and status='active' and (expires_at is null or expires_at>now()));
$$;
create or replace function public.mn_owns_family(p_family_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(select 1 from public.mn_families where id=p_family_id and owner_user_id=auth.uid());
$$;
create or replace function public.mn_is_family_member(p_family_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.mn_subscription_active(p_family_id) and auth.uid() is not null and (
    public.mn_owns_family(p_family_id) or exists(select 1 from public.mn_adults where family_id=p_family_id and user_id=auth.uid()));
$$;
create or replace function public.mn_has_full_family_access(p_family_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.mn_subscription_active(p_family_id) and auth.uid() is not null and (
    public.mn_owns_family(p_family_id) or exists(select 1 from public.mn_adults where family_id=p_family_id and user_id=auth.uid() and role in ('owner','parent','guardian')));
$$;
-- Listing and billing remain available while access to children's data is suspended.
create or replace function public.mn_list_my_families()
returns table(id uuid,owner_user_id uuid,name text,family_code text,created_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select f.id,f.owner_user_id,f.name,case when public.mn_has_full_family_access(f.id) then f.family_code else '' end,f.created_at
  from public.mn_families f where f.owner_user_id=auth.uid() or exists(select 1 from public.mn_adults a where a.family_id=f.id and a.user_id=auth.uid()) order by f.created_at;
$$;
-- Restrictive policies AND the subscription gate with all existing role policies.
do $$ declare t text; begin
  foreach t in array array['mn_adults','mn_children','mn_categories','mn_missions','mn_assignments','mn_quiz_attempts','mn_parent_invites','mn_family_join_requests'] loop
    execute format('drop policy if exists mn_subscription_gate on public.%I',t);
    execute format('create policy mn_subscription_gate on public.%I as restrictive for all to anon,authenticated using(public.mn_subscription_active(family_id)) with check(public.mn_subscription_active(family_id))',t);
  end loop;
end $$;
drop policy if exists mn_subscription_gate on public.mn_families;
create policy mn_subscription_gate on public.mn_families as restrictive for all to anon,authenticated using(public.mn_subscription_active(id)) with check(public.mn_subscription_active(id));
drop policy if exists mn_subscription_gate on public.mn_quiz_questions;
create policy mn_subscription_gate on public.mn_quiz_questions as restrictive for all to anon,authenticated
using(exists(select 1 from public.mn_missions m where m.id=mission_id and public.mn_subscription_active(m.family_id)))
with check(exists(select 1 from public.mn_missions m where m.id=mission_id and public.mn_subscription_active(m.family_id)));
drop policy if exists mn_subscription_gate on public.mn_quiz_answers;
create policy mn_subscription_gate on public.mn_quiz_answers as restrictive for all to anon,authenticated
using(exists(select 1 from public.mn_assignments a where a.id=assignment_id and public.mn_subscription_active(a.family_id)))
with check(exists(select 1 from public.mn_assignments a where a.id=assignment_id and public.mn_subscription_active(a.family_id)));
revoke insert on public.mn_families from authenticated;

create or replace function public.mn_request_subscription(p_family_name text,p_parent_name text,p_child_name text,p_kid_pin text,p_plan text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare f uuid; begin
  if auth.uid() is null then raise exception 'Login required.'; end if;
  if length(trim(p_family_name)) not between 1 and 100 or length(trim(p_parent_name)) not between 1 and 100 or length(trim(p_child_name)) not between 1 and 100 or length(trim(p_kid_pin)) not between 4 and 32 or p_plan not in ('monthly','quarterly','annual') then raise exception 'Complete the family details, PIN and plan.'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if exists(select 1 from public.mn_families where owner_user_id=auth.uid()) then raise exception 'Your family already exists. Open its Subscription page.'; end if;
  insert into public.mn_families(owner_user_id,name,family_code) values(auth.uid(),trim(p_family_name),upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))) returning id into f;
  insert into public.mn_subscriptions(family_id,status,plan) values(f,'pending',p_plan);
  insert into public.mn_adults(family_id,user_id,display_name,role) values(f,auth.uid(),trim(p_parent_name),'owner');
  insert into public.mn_children(family_id,display_name,kid_pin) values(f,trim(p_child_name),trim(p_kid_pin));
  insert into public.mn_categories(family_id,name) select f,unnest(array['Chore','Lesson','Routine','Habit','Quiz']);
  insert into public.mn_billing_events(family_id,actor_id,event) values(f,auth.uid(),'family_requested');
  return f;
end $$;
create or replace function public.mn_my_subscription(p_family_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s jsonb; begin
  if not(public.mn_owns_family(p_family_id) or exists(select 1 from public.mn_adults where family_id=p_family_id and user_id=auth.uid())) then raise exception 'Family access required.'; end if;
  select to_jsonb(b)||jsonb_build_object('status',case when b.status='active' and b.expires_at<=now() then 'suspended' else b.status end,'is_owner',public.mn_owns_family(p_family_id),'server_now',now()) into s from public.mn_subscriptions b where family_id=p_family_id;
  if public.mn_owns_family(p_family_id) then
    s=s||jsonb_build_object('settings',(select to_jsonb(x)-'id' from public.mn_billing_settings x where id),'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.mn_subscription_payments p where family_id=p_family_id),'[]'::jsonb));
  end if;
  return s;
end $$;
create or replace function public.mn_submit_payment(p_family_id uuid,p_plan text,p_reference text,p_amount numeric) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; begin
  if not public.mn_owns_family(p_family_id) then raise exception 'Only the family owner can submit payment.'; end if;
  if p_plan not in ('monthly','quarterly','annual') or length(trim(p_reference)) not between 6 and 64 or p_amount is null or p_amount<=0 then raise exception 'Enter the plan, GCash reference number and amount paid.'; end if;
  insert into public.mn_subscription_payments(family_id,submitted_by,plan,reference,amount) values(p_family_id,auth.uid(),p_plan,trim(p_reference),p_amount) returning id into result;
  insert into public.mn_billing_events(family_id,actor_id,event,detail) values(p_family_id,auth.uid(),'payment_submitted',jsonb_build_object('payment_id',result));
  return result;
end $$;
create or replace function public.mn_admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.mn_is_platform_admin() then raise exception 'Administrator access required.'; end if;
  return jsonb_build_object('settings',(select to_jsonb(x) from public.mn_billing_settings x where id),
    'families',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('name',f.name,'owner_email',u.email,'effective_status',case when s.status='active' and s.expires_at<=now() then 'suspended' else s.status end) order by f.created_at desc) from public.mn_subscriptions s join public.mn_families f on f.id=s.family_id join auth.users u on u.id=f.owner_user_id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.mn_subscription_payments p),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select * from public.mn_billing_events order by created_at desc limit 100)e),'[]'::jsonb));
end $$;
create or replace function public.mn_admin_settings(p_number text,p_name text,p_instructions text,p_monthly numeric,p_quarterly numeric,p_annual numeric) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.mn_is_platform_admin() then raise exception 'Administrator access required.'; end if;
  if trim(p_number)='' then raise exception 'GCash number is required.'; end if;
  update public.mn_billing_settings set gcash_number=trim(p_number),account_name=trim(p_name),instructions=trim(p_instructions),monthly_price=p_monthly,quarterly_price=p_quarterly,annual_price=p_annual where id;
  insert into public.mn_billing_events(actor_id,event) values(auth.uid(),'settings_updated');
end $$;
create or replace function public.mn_admin_message(p_family_id uuid,p_message text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.mn_is_platform_admin() then raise exception 'Administrator access required.'; end if;
  update public.mn_subscriptions set message=trim(p_message),updated_at=now() where family_id=p_family_id;
  if not found then raise exception 'Subscription not found.'; end if;
  insert into public.mn_billing_events(family_id,actor_id,event) values(p_family_id,auth.uid(),'payment_instructions_sent');
end $$;
create or replace function public.mn_admin_access(p_family_id uuid,p_status text,p_plan text,p_expires_at timestamptz,p_note text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.mn_is_platform_admin() then raise exception 'Administrator access required.'; end if;
  if p_status not in ('active','suspended') or p_plan not in ('monthly','quarterly','annual','custom','no_expiry') or (p_status='active' and p_plan<>'no_expiry' and (p_expires_at is null or p_expires_at<=now())) then raise exception 'Choose a valid status, plan and future expiry.'; end if;
  update public.mn_subscriptions set status=p_status,plan=p_plan,expires_at=case when p_plan='no_expiry' then null else p_expires_at end,message=coalesce(p_note,''),updated_at=now() where family_id=p_family_id;
  if not found then raise exception 'Subscription not found.'; end if;
  insert into public.mn_billing_events(family_id,actor_id,event,detail) values(p_family_id,auth.uid(),'access_changed',jsonb_build_object('status',p_status,'plan',p_plan,'expiry',p_expires_at,'note',p_note));
end $$;
create or replace function public.mn_admin_payment(p_payment_id uuid,p_approve boolean,p_note text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.mn_subscription_payments; s public.mn_subscriptions; ending timestamptz; begin
  if not public.mn_is_platform_admin() then raise exception 'Administrator access required.'; end if;
  select * into p from public.mn_subscription_payments where id=p_payment_id for update;
  if not found or p.status<>'pending' then raise exception 'Payment was already processed or not found.'; end if;
  select * into s from public.mn_subscriptions where family_id=p.family_id for update;
  if p_approve then
    ending=greatest(now(),coalesce(s.expires_at,now()))+case p.plan when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end;
    update public.mn_subscriptions set status='active',plan=p.plan,expires_at=ending,message=coalesce(p_note,''),updated_at=now() where family_id=p.family_id;
  end if;
  update public.mn_subscription_payments set status=case when p_approve then 'approved' else 'rejected' end,admin_note=coalesce(p_note,''),decided_by=auth.uid(),decided_at=now() where id=p.id;
  insert into public.mn_billing_events(family_id,actor_id,event,detail) values(p.family_id,auth.uid(),case when p_approve then 'payment_approved' else 'payment_rejected' end,jsonb_build_object('payment_id',p.id,'expiry',ending,'note',p_note));
end $$;
-- No billing mutation is available anonymously, and admin membership is SQL-only.
revoke all on function public.mn_is_platform_admin(),public.mn_owns_family(uuid),public.mn_request_subscription(text,text,text,text,text),public.mn_my_subscription(uuid),public.mn_submit_payment(uuid,text,text,numeric),public.mn_admin_dashboard(),public.mn_admin_settings(text,text,text,numeric,numeric,numeric),public.mn_admin_message(uuid,text),public.mn_admin_access(uuid,text,text,timestamptz,text),public.mn_admin_payment(uuid,boolean,text) from public,anon;
grant execute on function public.mn_is_platform_admin(),public.mn_owns_family(uuid),public.mn_request_subscription(text,text,text,text,text),public.mn_my_subscription(uuid),public.mn_submit_payment(uuid,text,text,numeric),public.mn_admin_dashboard(),public.mn_admin_settings(text,text,text,numeric,numeric,numeric),public.mn_admin_message(uuid,text),public.mn_admin_access(uuid,text,text,timestamptz,text),public.mn_admin_payment(uuid,boolean,text) to authenticated;
revoke all on function public.mn_subscription_active(uuid) from public;
grant execute on function public.mn_subscription_active(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
