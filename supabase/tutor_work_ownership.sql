-- Run after direct_invitations_and_tutors.sql.
-- Old work is not attributed to a tutor by guesswork; parents retain access to it.
begin;
alter table public.mn_missions add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.mn_missions alter column created_by set default auth.uid();
create index if not exists mn_missions_family_creator on public.mn_missions(family_id,created_by);

create or replace function public.mn_protect_mission_creator()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null then
    if tg_op='INSERT' then new.created_by=auth.uid();
    elsif new.created_by is distinct from old.created_by or new.family_id is distinct from old.family_id then
      raise exception 'A mission creator and family cannot be changed.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists mn_mission_creator_guard on public.mn_missions;
create trigger mn_mission_creator_guard before insert or update on public.mn_missions for each row execute function public.mn_protect_mission_creator();
revoke insert,update,delete on public.mn_missions from anon;

create or replace function public.mn_can_access_mission(p_mission_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.mn_missions m where m.id=p_mission_id and (
    public.mn_has_full_family_access(m.family_id) or
    (m.created_by=auth.uid() and public.mn_is_family_member(m.family_id) and
      (m.mission_type='quiz' or (m.mission_type='mission' and public.mn_can_create_lesson(m.family_id,m.category_id))))
  ));
$$;
drop policy if exists mn_tutor_missions_read on public.mn_missions;
create policy mn_tutor_missions_read on public.mn_missions for select to authenticated using(
  public.mn_has_full_family_access(family_id) or
  (created_by=auth.uid() and public.mn_is_family_member(family_id) and
    (mission_type='quiz' or (mission_type='mission' and public.mn_can_create_lesson(family_id,category_id))))
);
drop policy if exists mn_tutor_lesson_create on public.mn_missions;
drop policy if exists mn_tutor_work_create on public.mn_missions;
create policy mn_tutor_work_create on public.mn_missions for insert to authenticated with check(
  created_by=auth.uid() and public.mn_is_family_member(family_id) and
  (mission_type='quiz' or (mission_type='mission' and public.mn_can_create_lesson(family_id,category_id)))
);

create or replace function public.mn_valid_tutor_assignment(p_family_id uuid,p_mission_id uuid,p_child_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.mn_missions m join public.mn_children c on c.id=p_child_id and c.family_id=m.family_id
    where m.id=p_mission_id and m.family_id=p_family_id and m.created_by=auth.uid() and public.mn_can_access_mission(m.id));
$$;
drop policy if exists mn_tutor_assign_lesson on public.mn_assignments;
drop policy if exists mn_tutor_assign_owned_work on public.mn_assignments;
create policy mn_tutor_assign_owned_work on public.mn_assignments for insert to authenticated with check(
  status='assigned' and submitted_at is null and approved_at is null and public.mn_valid_tutor_assignment(family_id,mission_id,child_id)
);
drop policy if exists mn_tutor_questions_create on public.mn_quiz_questions;
create policy mn_tutor_questions_create on public.mn_quiz_questions for insert to authenticated with check(
  exists(select 1 from public.mn_missions m where m.id=mission_id and m.created_by=auth.uid() and m.mission_type='quiz' and public.mn_can_access_mission(m.id))
);

revoke all on function public.mn_protect_mission_creator(),public.mn_valid_tutor_assignment(uuid,uuid,uuid) from public,anon;
grant execute on function public.mn_valid_tutor_assignment(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
