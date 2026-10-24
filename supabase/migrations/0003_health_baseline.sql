-- Migration: 0003_health_baseline
-- Feature: health-baseline
-- Adds the per-user `weekly_features` table (one row per user per week) and enables
-- row-level security with per-user select/insert/update/delete policies keyed on
-- user_id = auth.uid(). Maya's rows are seeded only by POST /api/demo/start using the
-- service-role key, owned by the caller's auth.uid().
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

-- Tables --------------------------------------------------------------------

create table weekly_features (
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  vocabulary_diversity numeric,
  mean_sentence_length numeric,
  filler_rate numeric,
  sleep_hours numeric,
  active_minutes numeric,
  twin_accuracy numeric,
  synthetic boolean not null default false,
  -- One row per user per week; also the upsert conflict target. (Req 2.3, 2.10)
  constraint weekly_features_user_week_unique unique (user_id, week_start)
);

-- Row-level security --------------------------------------------------------

alter table weekly_features enable row level security;

create policy weekly_features_select on weekly_features for select using (user_id = auth.uid());
create policy weekly_features_insert on weekly_features for insert with check (user_id = auth.uid());
create policy weekly_features_update on weekly_features for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy weekly_features_delete on weekly_features for delete using (user_id = auth.uid());
