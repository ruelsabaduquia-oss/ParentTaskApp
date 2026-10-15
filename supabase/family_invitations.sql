-- Apply in the Supabase SQL Editor. Existing families and kid PIN access are preserved.
begin;

create table if not exists public.mn_parent_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  code text not null unique,
  role text not null check (role in ('parent', 'guardian')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.mn_family_join_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  invite_id uuid not null references public.mn_parent_invites(id),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  role text not null check (role in ('parent', 'guardian')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, requester_user_id)
);
alter table public.mn_parent_invites enable row level security;
alter table public.mn_family_join_requests enable row level security;

create or replace function public.mn_is_family_member(p_family_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    exists(select 1 from public.mn_families where id = p_family_id and owner_user_id = auth.uid())
    or exists(select 1 from public.mn_adults where family_id = p_family_id and user_id = auth.uid())
  );
$$;

create or replace function public.mn_create_parent_invite(p_family_id uuid, p_role text default 'parent')
returns public.mn_parent_invites language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.mn_parent_invites;
begin
  if auth.uid() is null or not exists(select 1 from public.mn_families where id=p_family_id and owner_user_id=auth.uid()) then
    raise exception 'Only the family owner can invite a parent or guardian.';
  end if;
  if p_role not in ('parent','guardian') then raise exception 'Choose Parent or Guardian.'; end if;
  update public.mn_parent_invites set revoked_at=now() where family_id=p_family_id and revoked_at is null;
  insert into public.mn_parent_invites(family_id, code, role, created_by)
    values(p_family_id, upper(replace(gen_random_uuid()::text, '-', '')), p_role, auth.uid()) returning * into result;
  return result;
end;
$$;

create or replace function public.mn_request_family_join(p_code text, p_display_name text)
returns public.mn_family_join_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare invitation public.mn_parent_invites; result public.mn_family_join_requests; account_email text;
begin
  if auth.uid() is null then raise exception 'Sign in before joining a family.'; end if;
  if nullif(trim(p_display_name), '') is null then raise exception 'Enter your name.'; end if;
  select * into invitation from public.mn_parent_invites
    where code=upper(regexp_replace(p_code, '\s', '', 'g')) and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'This invitation code is invalid or expired. Ask the family owner for a new code.'; end if;
  if public.mn_is_family_member(invitation.family_id) then raise exception 'You already belong to this family.'; end if;
  select email into account_email from auth.users where id=auth.uid();
  insert into public.mn_family_join_requests(family_id, invite_id, requester_user_id, display_name, email, role)
    values(invitation.family_id, invitation.id, auth.uid(), trim(p_display_name), coalesce(account_email,''), invitation.role)
    on conflict (family_id, requester_user_id) do update set
      invite_id=excluded.invite_id, display_name=excluded.display_name, role=excluded.role,
      email=excluded.email, status='pending', decided_at=null, created_at=now()
    returning * into result;
  return result;
end;
$$;

create or replace function public.mn_decide_family_join(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare request public.mn_family_join_requests;
begin
  select * into request from public.mn_family_join_requests where id=p_request_id for update;
  if not found then raise exception 'Join request was not found.'; end if;
  if auth.uid() is null or not exists(select 1 from public.mn_families where id=request.family_id and owner_user_id=auth.uid()) then
    raise exception 'Only the family owner can approve or decline this request.';
  end if;
  if request.status <> 'pending' then raise exception 'This request was already processed.'; end if;
  if p_approve then
    insert into public.mn_adults(family_id,user_id,display_name,role)
      select request.family_id,request.requester_user_id,request.display_name,request.role
      where not exists(select 1 from public.mn_adults where family_id=request.family_id and user_id=request.requester_user_id);
  end if;
  update public.mn_family_join_requests set status=case when p_approve then 'approved' else 'declined' end, decided_at=now() where id=request.id;
end;
$$;

revoke all on public.mn_parent_invites, public.mn_family_join_requests from anon, authenticated;
-- Child login never writes adult memberships or creates families.
revoke all on public.mn_adults from anon;
revoke insert, update, delete on public.mn_families from anon;
grant select on public.mn_parent_invites, public.mn_family_join_requests to authenticated;
drop policy if exists mn_invites_owner_read on public.mn_parent_invites;
create policy mn_invites_owner_read on public.mn_parent_invites for select to authenticated using (
  exists(select 1 from public.mn_families where id=family_id and owner_user_id=auth.uid())
);
drop policy if exists mn_join_requests_read on public.mn_family_join_requests;
create policy mn_join_requests_read on public.mn_family_join_requests for select to authenticated using (
  requester_user_id=auth.uid() or exists(select 1 from public.mn_families where id=family_id and owner_user_id=auth.uid())
);

-- Replace the prototype's unrestricted signed-in access with family membership checks.
-- The anonymous policies remain for the existing child name/PIN login.
alter policy mn_families_anon_all on public.mn_families to anon;
alter policy mn_adults_anon_all on public.mn_adults to anon;
alter policy mn_children_anon_all on public.mn_children to anon;
alter policy mn_categories_anon_all on public.mn_categories to anon;
alter policy mn_missions_anon_all on public.mn_missions to anon;
alter policy mn_assignments_anon_all on public.mn_assignments to anon;
alter policy mn_quiz_questions_anon_all on public.mn_quiz_questions to anon;
alter policy mn_quiz_answers_anon_all on public.mn_quiz_answers to anon;
alter policy mn_quiz_attempts_anon_all on public.mn_quiz_attempts to anon;

drop policy if exists mn_families_parent_read on public.mn_families;
create policy mn_families_parent_read on public.mn_families for select to authenticated using(public.mn_is_family_member(id));
drop policy if exists mn_families_parent_create on public.mn_families;
create policy mn_families_parent_create on public.mn_families for insert to authenticated with check(owner_user_id=auth.uid());
drop policy if exists mn_families_owner_update on public.mn_families;
create policy mn_families_owner_update on public.mn_families for update to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());
drop policy if exists mn_adults_parent_read on public.mn_adults;
create policy mn_adults_parent_read on public.mn_adults for select to authenticated using(user_id=auth.uid() or public.mn_is_family_member(family_id));
drop policy if exists mn_adults_owner_write on public.mn_adults;
create policy mn_adults_owner_write on public.mn_adults for all to authenticated using(
  exists(select 1 from public.mn_families where id=family_id and owner_user_id=auth.uid())
) with check(exists(select 1 from public.mn_families where id=family_id and owner_user_id=auth.uid()));

do $$ declare name text; begin
  foreach name in array array['mn_children','mn_categories','mn_missions','mn_assignments','mn_quiz_attempts'] loop
    execute format('drop policy if exists mn_parent_member_access on public.%I', name);
    execute format('create policy mn_parent_member_access on public.%I for all to authenticated using(public.mn_is_family_member(family_id)) with check(public.mn_is_family_member(family_id))', name);
  end loop;
end $$;
drop policy if exists mn_questions_parent_access on public.mn_quiz_questions;
create policy mn_questions_parent_access on public.mn_quiz_questions for all to authenticated
  using(exists(select 1 from public.mn_missions where id=mission_id and public.mn_is_family_member(family_id)))
  with check(exists(select 1 from public.mn_missions where id=mission_id and public.mn_is_family_member(family_id)));
drop policy if exists mn_answers_parent_access on public.mn_quiz_answers;
create policy mn_answers_parent_access on public.mn_quiz_answers for all to authenticated
  using(exists(select 1 from public.mn_assignments where id=assignment_id and public.mn_is_family_member(family_id)))
  with check(exists(select 1 from public.mn_assignments where id=assignment_id and public.mn_is_family_member(family_id)));

revoke all on function public.mn_is_family_member(uuid), public.mn_create_parent_invite(uuid,text), public.mn_request_family_join(text,text), public.mn_decide_family_join(uuid,boolean) from public, anon;
grant execute on function public.mn_is_family_member(uuid), public.mn_create_parent_invite(uuid,text), public.mn_request_family_join(text,text), public.mn_decide_family_join(uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
