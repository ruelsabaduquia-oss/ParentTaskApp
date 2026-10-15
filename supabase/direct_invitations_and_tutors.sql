-- Run after family_invitations.sql. Existing family codes continue to work.
begin;
create table if not exists public.mn_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$')
);
alter table public.mn_profiles enable row level security;
revoke all on public.mn_profiles from anon, authenticated;
grant select on public.mn_profiles to authenticated;
drop policy if exists mn_profile_self on public.mn_profiles;
create policy mn_profile_self on public.mn_profiles for select to authenticated using(user_id=auth.uid());
alter table public.mn_parent_invites drop constraint if exists mn_parent_invites_role_check;
alter table public.mn_parent_invites add constraint mn_parent_invites_role_check check(role in ('parent','guardian','tutor'));
alter table public.mn_family_join_requests drop constraint if exists mn_family_join_requests_role_check;
alter table public.mn_family_join_requests add constraint mn_family_join_requests_role_check check(role in ('parent','guardian','tutor'));
alter table public.mn_parent_invites add column if not exists target_user_id uuid references auth.users(id) on delete cascade;
alter table public.mn_parent_invites add column if not exists target_email text;
alter table public.mn_parent_invites add column if not exists family_name text;
alter table public.mn_parent_invites add column if not exists inviter_name text;
alter table public.mn_parent_invites add column if not exists status text not null default 'pending' check(status in ('pending','accepted','declined','revoked'));
create index if not exists mn_parent_invites_recipient on public.mn_parent_invites(target_user_id,status);

create or replace function public.mn_has_full_family_access(p_family_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (
    exists(select 1 from public.mn_families where id=p_family_id and owner_user_id=auth.uid()) or
    exists(select 1 from public.mn_adults where family_id=p_family_id and user_id=auth.uid() and role in ('owner','parent','guardian'))
  );
$$;
create or replace function public.mn_can_access_mission(p_mission_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.mn_missions m where m.id=p_mission_id and (
    public.mn_has_full_family_access(m.family_id) or
    (public.mn_is_family_member(m.family_id) and (m.mission_type='quiz' or
      (m.mission_type='mission' and exists(select 1 from public.mn_categories c where c.id=m.category_id and c.family_id=m.family_id and lower(trim(c.name)) in ('lesson','lessons')))))
  ));
$$;
create or replace function public.mn_can_create_lesson(p_family_id uuid,p_category_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.mn_is_family_member(p_family_id) and exists(select 1 from public.mn_categories where id=p_category_id and family_id=p_family_id and lower(trim(name)) in ('lesson','lessons'));
$$;

create or replace function public.mn_set_username(p_username text)
returns public.mn_profiles language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.mn_profiles; normalized text := lower(trim(p_username));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if normalized !~ '^[a-z0-9_]{3,32}$' then raise exception 'Use 3 to 32 letters, numbers, or underscores for your username.'; end if;
  insert into public.mn_profiles(user_id,username) values(auth.uid(),normalized)
    on conflict(user_id) do update set username=excluded.username returning * into result;
  return result;
exception when unique_violation then raise exception 'This username is already taken.';
end;
$$;

create or replace function public.mn_send_family_invitation(p_family_id uuid,p_recipient text,p_role text)
returns public.mn_parent_invites language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; mail text; family public.mn_families; result public.mn_parent_invites; owner_name text;
begin
  select * into family from public.mn_families where id=p_family_id for update;
  if auth.uid() is null or family.owner_user_id is distinct from auth.uid() then raise exception 'Only the family owner can invite members.'; end if;
  if p_role is null or p_role not in ('parent','guardian','tutor') then raise exception 'Choose Parent, Guardian, or Tutor.'; end if;
  if position('@' in p_recipient)>0 then
    select id,email into target,mail from auth.users where lower(email)=lower(trim(p_recipient));
  else
    select u.id,u.email into target,mail from auth.users u join public.mn_profiles p on p.user_id=u.id where p.username=lower(trim(p_recipient));
  end if;
  if target is null then raise exception 'No registered account matches that email or username.'; end if;
  if target=auth.uid() or exists(select 1 from public.mn_adults where family_id=p_family_id and user_id=target) then raise exception 'This account already belongs to the family.'; end if;
  select display_name into owner_name from public.mn_adults where family_id=p_family_id and user_id=auth.uid() limit 1;
  update public.mn_parent_invites set revoked_at=now(),status='revoked' where family_id=p_family_id and target_user_id=target and status='pending';
  insert into public.mn_parent_invites(family_id,code,role,created_by,target_user_id,target_email,family_name,inviter_name)
    values(p_family_id,upper(replace(gen_random_uuid()::text,'-','')),p_role,auth.uid(),target,mail,family.name,coalesce(owner_name,'Family owner')) returning * into result;
  return result;
end;
$$;

create or replace function public.mn_respond_family_invitation(p_invite_id uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.mn_parent_invites; member_name text;
begin
  -- Lock the family before the invitation, matching send/disconnect lock order.
  perform 1 from public.mn_families where id=(select family_id from public.mn_parent_invites where id=p_invite_id) for update;
  select * into invitation from public.mn_parent_invites where id=p_invite_id for update;
  if not found or auth.uid() is null or invitation.target_user_id is distinct from auth.uid() then raise exception 'This invitation is not addressed to your account.'; end if;
  if invitation.status<>'pending' or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'This invitation is expired or already handled.'; end if;
  if not exists(select 1 from public.mn_families where id=invitation.family_id and owner_user_id=invitation.created_by) then raise exception 'This invitation is no longer valid.'; end if;
  if p_accept then
    select coalesce((select username from public.mn_profiles where user_id=auth.uid()),
      (select display_name from public.mn_adults where user_id=auth.uid() limit 1),split_part(email,'@',1)) into member_name from auth.users where id=auth.uid();
    insert into public.mn_adults(family_id,user_id,display_name,role)
      select invitation.family_id,auth.uid(),member_name,invitation.role
      where not exists(select 1 from public.mn_adults where family_id=invitation.family_id and user_id=auth.uid());
  end if;
  update public.mn_parent_invites set status=case when p_accept then 'accepted' else 'declined' end where id=invitation.id;
  return invitation.family_id;
end;
$$;

create or replace function public.mn_disconnect_family_member(p_adult_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare member public.mn_adults;
begin
  perform 1 from public.mn_families where id=(select family_id from public.mn_adults where id=p_adult_id) for update;
  select * into member from public.mn_adults where id=p_adult_id for update;
  if not found then raise exception 'Member was not found.'; end if;
  if auth.uid() is null or not exists(select 1 from public.mn_families where id=member.family_id and owner_user_id=auth.uid()) then raise exception 'Only the family owner can disconnect members.'; end if;
  if member.user_id=auth.uid() or member.role='owner' then raise exception 'The family owner cannot be disconnected.'; end if;
  delete from public.mn_adults where family_id=member.family_id and user_id=member.user_id;
  update public.mn_parent_invites set status='revoked',revoked_at=now() where family_id=member.family_id and target_user_id=member.user_id and status='pending';
  update public.mn_family_join_requests set status='declined',decided_at=now() where family_id=member.family_id and requester_user_id=member.user_id;
end;
$$;

create or replace function public.mn_my_family_invitations()
returns table(id uuid,family_name text,inviter_name text,role text,expires_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select i.id,i.family_name,i.inviter_name,i.role,i.expires_at from public.mn_parent_invites i
    where i.target_user_id=auth.uid() and i.status='pending' and i.revoked_at is null and i.expires_at>now() order by i.created_at;
$$;
create or replace function public.mn_list_my_families()
returns table(id uuid,owner_user_id uuid,name text,family_code text,created_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select f.id,f.owner_user_id,f.name,case when public.mn_has_full_family_access(f.id) then f.family_code else '' end,f.created_at
    from public.mn_families f where public.mn_is_family_member(f.id) order by f.created_at;
$$;
create or replace function public.mn_tutor_children(p_family_id uuid)
returns table(id uuid,family_id uuid,display_name text,age integer,grade text,stars integer)
language sql stable security definer set search_path=public,pg_temp as $$
  select c.id,c.family_id,c.display_name,c.age,c.grade,c.stars from public.mn_children c
    where c.family_id=p_family_id and public.mn_is_family_member(p_family_id) order by c.display_name;
$$;

-- Read-only tutor visibility; only parents/guardians can alter existing work.
alter policy mn_families_parent_read on public.mn_families using(public.mn_has_full_family_access(id));
alter policy mn_adults_parent_read on public.mn_adults using(user_id=auth.uid() or public.mn_has_full_family_access(family_id));
do $$ declare name text; begin
  foreach name in array array['mn_children','mn_categories','mn_missions','mn_assignments','mn_quiz_attempts'] loop
    execute format('drop policy if exists mn_parent_member_access on public.%I',name);
  end loop;
end $$;
create policy mn_parent_member_access on public.mn_children for all to authenticated using(public.mn_has_full_family_access(family_id)) with check(public.mn_has_full_family_access(family_id));
create policy mn_parent_member_access on public.mn_categories for all to authenticated using(public.mn_has_full_family_access(family_id)) with check(public.mn_has_full_family_access(family_id));
drop policy if exists mn_tutor_categories_read on public.mn_categories;
create policy mn_tutor_categories_read on public.mn_categories for select to authenticated using(public.mn_is_family_member(family_id) and lower(trim(name)) in ('lesson','lessons','quiz'));
create policy mn_parent_member_access on public.mn_missions for all to authenticated using(public.mn_has_full_family_access(family_id)) with check(public.mn_has_full_family_access(family_id));
drop policy if exists mn_tutor_missions_read on public.mn_missions;
create policy mn_tutor_missions_read on public.mn_missions for select to authenticated using(
  public.mn_has_full_family_access(family_id) or
  (public.mn_is_family_member(family_id) and (mission_type='quiz' or (mission_type='mission' and public.mn_can_create_lesson(family_id,category_id))))
);
drop policy if exists mn_tutor_lesson_create on public.mn_missions;
create policy mn_tutor_lesson_create on public.mn_missions for insert to authenticated with check(mission_type='mission' and public.mn_can_create_lesson(family_id,category_id));
create policy mn_parent_member_access on public.mn_assignments for all to authenticated using(public.mn_has_full_family_access(family_id)) with check(public.mn_has_full_family_access(family_id));
drop policy if exists mn_tutor_assignments_read on public.mn_assignments;
create policy mn_tutor_assignments_read on public.mn_assignments for select to authenticated using(
  public.mn_is_family_member(family_id) and exists(select 1 from public.mn_missions where id=mission_id and mn_missions.family_id=mn_assignments.family_id and public.mn_can_access_mission(id))
);
-- A definer helper verifies the child without granting tutors access to kid PINs.
create or replace function public.mn_valid_lesson_assignment(p_family_id uuid,p_mission_id uuid,p_child_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.mn_missions m join public.mn_children c on c.id=p_child_id and c.family_id=m.family_id
    where m.id=p_mission_id and m.family_id=p_family_id and m.mission_type='mission' and public.mn_can_create_lesson(m.family_id,m.category_id));
$$;
drop policy if exists mn_tutor_assign_lesson on public.mn_assignments;
create policy mn_tutor_assign_lesson on public.mn_assignments for insert to authenticated with check(
  status='assigned' and submitted_at is null and approved_at is null and public.mn_valid_lesson_assignment(family_id,mission_id,child_id)
);
create policy mn_parent_member_access on public.mn_quiz_attempts for all to authenticated using(public.mn_has_full_family_access(family_id)) with check(public.mn_has_full_family_access(family_id));
drop policy if exists mn_tutor_attempts_read on public.mn_quiz_attempts;
create policy mn_tutor_attempts_read on public.mn_quiz_attempts for select to authenticated using(public.mn_is_family_member(family_id) and public.mn_can_access_mission(mission_id));
drop policy if exists mn_questions_parent_access on public.mn_quiz_questions;
create policy mn_questions_parent_access on public.mn_quiz_questions for all to authenticated using(exists(select 1 from public.mn_missions where id=mission_id and public.mn_has_full_family_access(family_id))) with check(exists(select 1 from public.mn_missions where id=mission_id and public.mn_has_full_family_access(family_id)));
drop policy if exists mn_tutor_questions_read on public.mn_quiz_questions;
create policy mn_tutor_questions_read on public.mn_quiz_questions for select to authenticated using(public.mn_can_access_mission(mission_id));
drop policy if exists mn_answers_parent_access on public.mn_quiz_answers;
create policy mn_answers_parent_access on public.mn_quiz_answers for all to authenticated using(exists(select 1 from public.mn_assignments where id=assignment_id and public.mn_has_full_family_access(family_id))) with check(exists(select 1 from public.mn_assignments where id=assignment_id and public.mn_has_full_family_access(family_id)));
drop policy if exists mn_tutor_answers_read on public.mn_quiz_answers;
create policy mn_tutor_answers_read on public.mn_quiz_answers for select to authenticated using(exists(select 1 from public.mn_assignments where id=assignment_id and public.mn_can_access_mission(mission_id)));

-- Directed invitations must never be redeemed using the legacy shared-code path.
create or replace function public.mn_guard_direct_invite_request()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.mn_parent_invites where id=new.invite_id and target_user_id is not null) then raise exception 'Accept or decline this invitation in your notifications.'; end if;
  return new;
end;
$$;
drop trigger if exists mn_direct_invite_guard on public.mn_family_join_requests;
create trigger mn_direct_invite_guard before insert or update on public.mn_family_join_requests for each row execute function public.mn_guard_direct_invite_request();

revoke all on function public.mn_has_full_family_access(uuid),public.mn_can_access_mission(uuid),public.mn_can_create_lesson(uuid,uuid),public.mn_set_username(text),public.mn_send_family_invitation(uuid,text,text),public.mn_respond_family_invitation(uuid,boolean),public.mn_disconnect_family_member(uuid),public.mn_my_family_invitations(),public.mn_list_my_families(),public.mn_tutor_children(uuid),public.mn_valid_lesson_assignment(uuid,uuid,uuid),public.mn_guard_direct_invite_request() from public,anon;
grant execute on function public.mn_has_full_family_access(uuid),public.mn_can_access_mission(uuid),public.mn_can_create_lesson(uuid,uuid),public.mn_set_username(text),public.mn_send_family_invitation(uuid,text,text),public.mn_respond_family_invitation(uuid,boolean),public.mn_disconnect_family_member(uuid),public.mn_my_family_invitations(),public.mn_list_my_families(),public.mn_tutor_children(uuid),public.mn_valid_lesson_assignment(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
