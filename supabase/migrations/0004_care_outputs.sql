-- Migration: 0004_care_outputs
-- Feature: care-outputs
-- Adds the relative's relation for the clinician summary's family-history field
-- (for Maya, "father"). The existing per-user RLS policies on `profiles` already
-- cover the new column.
-- Requirements: 1.2

alter table profiles
  add column if not exists family_history_relation text
  check (family_history_relation is null or char_length(family_history_relation) between 1 and 40);
