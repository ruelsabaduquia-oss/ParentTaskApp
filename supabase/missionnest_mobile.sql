create extension if not exists pgcrypto;

create table if not exists public.mn_families (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  family_code text not null unique,
  parent_pin text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.mn_adults (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role text not null default 'parent',
  created_at timestamptz not null default now()
);

alter table public.mn_families add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
alter table public.mn_families alter column parent_pin set default '';
alter table public.mn_adults add column if not exists user_id uuid references auth.users(id) on delete set null;

create table if not exists public.mn_children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  display_name text not null,
  kid_pin text not null default '1234',
  age int not null default 8,
  grade text not null default '',
  stars int not null default 0,
  focus_elapsed_seconds int not null default 0,
  focus_started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mn_children add column if not exists focus_elapsed_seconds int not null default 0;
alter table public.mn_children add column if not exists focus_started_at timestamptz;

create table if not exists public.mn_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.mn_missions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  category_id uuid references public.mn_categories(id) on delete set null,
  title text not null,
  instructions text not null default '',
  due_at timestamptz,
  reward_stars int not null default 25,
  requires_approval boolean not null default true,
  mission_type text not null default 'mission',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  source_text text not null default '',
  passing_percent int not null default 80,
  created_at timestamptz not null default now()
);

create table if not exists public.mn_assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  mission_id uuid not null references public.mn_missions(id) on delete cascade,
  child_id uuid not null references public.mn_children(id) on delete cascade,
  status text not null default 'assigned',
  checklist_done jsonb not null default '{}'::jsonb,
  kid_comments jsonb not null default '{}'::jsonb,
  parent_comments jsonb not null default '{}'::jsonb,
  focus_elapsed_seconds int not null default 0,
  focus_started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_id, child_id)
);

alter table public.mn_assignments add column if not exists checklist_done jsonb not null default '{}'::jsonb;
alter table public.mn_assignments add column if not exists kid_comments jsonb not null default '{}'::jsonb;
alter table public.mn_assignments add column if not exists parent_comments jsonb not null default '{}'::jsonb;
alter table public.mn_assignments add column if not exists focus_elapsed_seconds int not null default 0;
alter table public.mn_assignments add column if not exists focus_started_at timestamptz;

create table if not exists public.mn_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.mn_missions(id) on delete cascade,
  sort_order int not null default 0,
  prompt text not null,
  choices jsonb not null default '[]'::jsonb,
  answer text not null default '',
  explanation text not null default ''
);

create table if not exists public.mn_quiz_answers (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mn_assignments(id) on delete cascade,
  question_id uuid not null references public.mn_quiz_questions(id) on delete cascade,
  answer text not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (assignment_id, question_id)
);

create table if not exists public.mn_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.mn_families(id) on delete cascade,
  assignment_id uuid not null references public.mn_assignments(id) on delete cascade,
  mission_id uuid not null references public.mn_missions(id) on delete cascade,
  child_id uuid not null references public.mn_children(id) on delete cascade,
  score int not null default 0,
  total int not null default 0,
  attempt_number int not null default 1,
  created_at timestamptz not null default now()
);

alter table public.mn_families enable row level security;
alter table public.mn_missions add column if not exists quiz_time_limit_seconds integer not null default 0 check (quiz_time_limit_seconds between 0 and 86400);
alter table public.mn_quiz_attempts add column if not exists duration_seconds integer check (duration_seconds >= 0);
alter table public.mn_quiz_attempts add column if not exists timed_out boolean not null default false;
alter table public.mn_adults enable row level security;
alter table public.mn_children enable row level security;
alter table public.mn_categories enable row level security;
alter table public.mn_missions enable row level security;
alter table public.mn_assignments enable row level security;
alter table public.mn_quiz_questions enable row level security;
alter table public.mn_quiz_answers enable row level security;
alter table public.mn_quiz_attempts enable row level security;

drop policy if exists "mn_families_anon_all" on public.mn_families;
drop policy if exists "mn_adults_anon_all" on public.mn_adults;
drop policy if exists "mn_children_anon_all" on public.mn_children;
drop policy if exists "mn_categories_anon_all" on public.mn_categories;
drop policy if exists "mn_missions_anon_all" on public.mn_missions;
drop policy if exists "mn_assignments_anon_all" on public.mn_assignments;
drop policy if exists "mn_quiz_questions_anon_all" on public.mn_quiz_questions;
drop policy if exists "mn_quiz_answers_anon_all" on public.mn_quiz_answers;
drop policy if exists "mn_quiz_attempts_anon_all" on public.mn_quiz_attempts;

-- Run family_invitations.sql after this script to install signed-in parent policies.
create policy "mn_families_anon_all" on public.mn_families for all to anon using (true) with check (true);
create policy "mn_adults_anon_all" on public.mn_adults for all to anon using (true) with check (true);
create policy "mn_children_anon_all" on public.mn_children for all to anon using (true) with check (true);
create policy "mn_categories_anon_all" on public.mn_categories for all to anon using (true) with check (true);
create policy "mn_missions_anon_all" on public.mn_missions for all to anon using (true) with check (true);
create policy "mn_assignments_anon_all" on public.mn_assignments for all to anon using (true) with check (true);
create policy "mn_quiz_questions_anon_all" on public.mn_quiz_questions for all to anon using (true) with check (true);
create policy "mn_quiz_answers_anon_all" on public.mn_quiz_answers for all to anon using (true) with check (true);
create policy "mn_quiz_attempts_anon_all" on public.mn_quiz_attempts for all to anon using (true) with check (true);

grant all on public.mn_families to anon, authenticated;
grant all on public.mn_adults to anon, authenticated;
grant all on public.mn_children to anon, authenticated;
grant all on public.mn_categories to anon, authenticated;
grant all on public.mn_missions to anon, authenticated;
grant all on public.mn_assignments to anon, authenticated;
grant all on public.mn_quiz_questions to anon, authenticated;
grant all on public.mn_quiz_answers to anon, authenticated;
grant all on public.mn_quiz_attempts to anon, authenticated;
revoke all on public.mn_adults from anon;
revoke insert, update, delete on public.mn_families from anon;
