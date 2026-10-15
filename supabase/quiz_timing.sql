-- Run once in the Supabase SQL Editor before using quiz timing.
alter table public.mn_missions
  add column if not exists quiz_time_limit_seconds integer not null default 0
  check (quiz_time_limit_seconds between 0 and 86400);
alter table public.mn_quiz_attempts
  add column if not exists duration_seconds integer check (duration_seconds >= 0);
alter table public.mn_quiz_attempts
  add column if not exists timed_out boolean not null default false;
notify pgrst, 'reload schema';
