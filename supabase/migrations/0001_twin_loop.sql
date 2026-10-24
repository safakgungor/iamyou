-- Migration: 0001_twin_loop
-- Feature: twin-loop
-- Creates the four per-user Vault tables (profiles, vault_entries, predictions,
-- answers) and enables row-level security with per-user select/insert/update/delete
-- policies keyed on user_id = auth.uid().
-- Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4

-- Tables --------------------------------------------------------------------

create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  first_name text,
  last_name text,
  date_of_birth date,
  county text,
  family_history text not null default 'prefer_not'
    check (family_history in ('huntington','familial_alzheimers','als','none','prefer_not')),
  health_layer_opt_in boolean not null default false,
  rtk_setting text not null default 'record_only'
    check (rtk_setting in ('tell_me','doctor_only','record_only')),
  digital_will jsonb,
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table vault_entries (
  user_id uuid not null references auth.users on delete cascade,
  id text not null default gen_random_uuid()::text,
  kind text not null
    check (kind in ('conversation','correction','story','opinion','style_example')),
  text text not null,
  created_at timestamptz not null default now(),
  synthetic boolean not null default false,
  primary key (user_id, id)
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  prompt_id text not null,
  predicted_text text not null,
  created_at timestamptz not null default now()
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  prediction_id uuid not null references predictions on delete cascade,
  session_id uuid not null,
  answer_text text not null,
  score numeric not null check (score between 0 and 1),
  rationale text,
  crisis boolean not null default false,
  created_at timestamptz not null default now()
);

-- Row-level security --------------------------------------------------------

alter table profiles enable row level security;
alter table vault_entries enable row level security;
alter table predictions enable row level security;
alter table answers enable row level security;

-- profiles
create policy profiles_select on profiles for select using (user_id = auth.uid());
create policy profiles_insert on profiles for insert with check (user_id = auth.uid());
create policy profiles_update on profiles for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy profiles_delete on profiles for delete using (user_id = auth.uid());

-- vault_entries
create policy vault_entries_select on vault_entries for select using (user_id = auth.uid());
create policy vault_entries_insert on vault_entries for insert with check (user_id = auth.uid());
create policy vault_entries_update on vault_entries for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy vault_entries_delete on vault_entries for delete using (user_id = auth.uid());

-- predictions
create policy predictions_select on predictions for select using (user_id = auth.uid());
create policy predictions_insert on predictions for insert with check (user_id = auth.uid());
create policy predictions_update on predictions for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy predictions_delete on predictions for delete using (user_id = auth.uid());

-- answers
create policy answers_select on answers for select using (user_id = auth.uid());
create policy answers_insert on answers for insert with check (user_id = auth.uid());
create policy answers_update on answers for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy answers_delete on answers for delete using (user_id = auth.uid());
