-- Run after subscriptions.sql. Existing balances are preserved.
begin;
create table if not exists public.mn_star_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  child_id uuid not null references public.mn_children(id) on delete cascade,
  -- Keep the source UUID after an assignment is deleted so history survives cleanup.
  assignment_id uuid,
  kind text not null check(kind in ('award','reset')),
  amount integer not null,
  title text not null default '',
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check((kind='award' and amount>=0 and assignment_id is not null) or (kind='reset' and amount<=0))
);
create unique index if not exists mn_star_award_once on public.mn_star_events(assignment_id) where kind='award';
create index if not exists mn_star_events_child_date on public.mn_star_events(family_id,child_id,created_at);
alter table public.mn_star_events enable row level security;
revoke all on public.mn_star_events from public,anon,authenticated;
grant select on public.mn_star_events to authenticated;
drop policy if exists mn_star_history_parent_read on public.mn_star_events;
create policy mn_star_history_parent_read on public.mn_star_events for select to authenticated
using(public.mn_has_full_family_access(family_id));

-- Backfill only retained approvals with real timestamps, without changing balances.
-- Older/deleted approvals or their original reward amounts cannot be reconstructed.
insert into public.mn_star_events(family_id,child_id,assignment_id,kind,amount,title,created_at)
select a.family_id,a.child_id,a.id,'award',greatest(0,m.reward_stars),m.title,a.approved_at
from public.mn_assignments a join public.mn_missions m on m.id=a.mission_id and m.family_id=a.family_id
join public.mn_children c on c.id=a.child_id and c.family_id=a.family_id
where a.status='approved' and a.approved_at is not null
on conflict do nothing;

create or replace function public.mn_record_star_award() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare reward integer; mission_title text; inserted integer;
begin
  if new.status='approved' and old.status is distinct from 'approved' then
    if not public.mn_has_full_family_access(new.family_id) then raise exception 'Only a parent or guardian can approve rewards.'; end if;
    if new.family_id<>old.family_id or new.child_id<>old.child_id then raise exception 'The reward recipient cannot be changed.'; end if;
    select greatest(0,m.reward_stars),m.title into reward,mission_title from public.mn_missions m
      join public.mn_children c on c.id=new.child_id and c.family_id=m.family_id
      where m.id=new.mission_id and m.family_id=new.family_id;
    if not found then raise exception 'Mission and child must belong to the same family.'; end if;
    new.approved_at=now();
    insert into public.mn_star_events(family_id,child_id,assignment_id,kind,amount,title,actor_id)
      values(new.family_id,new.child_id,new.id,'award',reward,mission_title,auth.uid()) on conflict do nothing;
    get diagnostics inserted=row_count;
    if inserted=1 then update public.mn_children set stars=stars+reward where id=new.child_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists mn_star_award on public.mn_assignments;
create trigger mn_star_award before update on public.mn_assignments for each row execute function public.mn_record_star_award();

-- Direct REST clients cannot change balances, including old APKs and child sessions.
create or replace function public.mn_protect_star_balance() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if current_user in ('anon','authenticated') then
    if (tg_op='INSERT' and new.stars<>0) or (tg_op='UPDATE' and new.stars is distinct from old.stars) then
      raise exception 'Use the parent approval or reset action to change stars.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mn_star_balance_guard on public.mn_children;
create trigger mn_star_balance_guard before insert or update on public.mn_children for each row execute function public.mn_protect_star_balance();

create or replace function public.mn_approve_assignment(p_assignment_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare task public.mn_assignments;
begin
  select * into task from public.mn_assignments where id=p_assignment_id for update;
  if not found or not public.mn_has_full_family_access(task.family_id) then raise exception 'Parent access required.'; end if;
  if task.status='approved' then return; end if;
  if task.status<>'submitted' then raise exception 'Only submitted tasks can be approved.'; end if;
  update public.mn_assignments set status='approved',focus_started_at=null where id=task.id;
end $$;

create or replace function public.mn_reset_child_stars(p_child_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare child public.mn_children;
begin
  select * into child from public.mn_children where id=p_child_id for update;
  if not found or not public.mn_has_full_family_access(child.family_id) then raise exception 'Parent access required.'; end if;
  if child.stars=0 then return; end if;
  insert into public.mn_star_events(family_id,child_id,kind,amount,title,actor_id)
    values(child.family_id,child.id,'reset',-child.stars,'Parent reset',auth.uid());
  update public.mn_children set stars=0 where id=child.id;
end $$;
revoke all on function public.mn_record_star_award(),public.mn_protect_star_balance(),public.mn_approve_assignment(uuid),public.mn_reset_child_stars(uuid) from public,anon,authenticated;
grant execute on function public.mn_approve_assignment(uuid),public.mn_reset_child_stars(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
