-- Migration: 0002_assistant
-- Feature: assistant-tasks
-- Adds the per-user `drafts` table for the assistant's reply drafts and enables
-- row-level security with per-user select/insert/update/delete policies keyed on
-- user_id = auth.uid(). The inbox is read-only synthetic data and is never stored.
-- Requirements: 4.1, 5.1, 5.3, 6.6

-- Tables --------------------------------------------------------------------

create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  inbox_message_id text not null,
  body text not null,
  state text not null default 'draft'
    check (state in ('draft','approved','sent','discarded')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- sent_at is set only in the `sent` state and null otherwise. (Req 5.1, 5.3)
  constraint drafts_sent_at_iff_sent
    check ((state = 'sent') = (sent_at is not null))
);

-- Row-level security --------------------------------------------------------

alter table drafts enable row level security;

create policy drafts_select on drafts for select using (user_id = auth.uid());
create policy drafts_insert on drafts for insert with check (user_id = auth.uid());
create policy drafts_update on drafts for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy drafts_delete on drafts for delete using (user_id = auth.uid());
