import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static check of the health-baseline migration: the SQL is read as text, no live
// database is used. Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0003_health_baseline.sql'),
  'utf8',
);

// Strip `--` line comments and collapse whitespace so assertions ignore formatting.
const normalized = sql
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

function tableBody(table: string): string {
  const match = normalized.match(new RegExp(`create table ${table} \\((.*?)\\);`));
  if (!match) throw new Error(`create table ${table} not found`);
  return match[1];
}

function columnNames(body: string): string[] {
  // Split on top-level commas only (ignores commas inside parentheses).
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts
    .filter((p) => !p.startsWith('constraint ') && !p.startsWith('unique ') && !p.startsWith('primary key'))
    .map((p) => p.split(' ')[0]);
}

describe('0003_health_baseline migration', () => {
  it('declares weekly_features with exactly the Req 2.1 columns', () => {
    const cols = columnNames(tableBody('weekly_features'));
    expect(cols.sort()).toEqual(
      [
        'user_id',
        'week_start',
        'vocabulary_diversity',
        'mean_sentence_length',
        'filler_rate',
        'sleep_hours',
        'active_minutes',
        'twin_accuracy',
        'synthetic',
      ].sort(),
    );
  });

  it('enforces uniqueness on (user_id, week_start)', () => {
    expect(tableBody('weekly_features')).toMatch(/unique \(user_id, ?week_start\)/);
  });

  it('enables row level security on weekly_features', () => {
    expect(normalized).toContain('alter table weekly_features enable row level security;');
  });

  it('defines select/insert/update/delete policies each keyed on user_id = auth.uid()', () => {
    const policies = [...normalized.matchAll(/create policy (\w+) on weekly_features for (\w+) ([^;]*);/g)];
    const byCommand = Object.fromEntries(policies.map((m) => [m[2], m[3]]));

    expect(policies).toHaveLength(4);
    expect(Object.keys(byCommand).sort()).toEqual(['delete', 'insert', 'select', 'update']);

    const owner = '\\(user_id = auth\\.uid\\(\\)\\)';
    expect(byCommand.select).toMatch(new RegExp(`^using ${owner}$`));
    expect(byCommand.insert).toMatch(new RegExp(`^with check ${owner}$`));
    expect(byCommand.update).toMatch(new RegExp(`^using ${owner} with check ${owner}$`));
    expect(byCommand.delete).toMatch(new RegExp(`^using ${owner}$`));
  });

  it('does not alter twin-loop or assistant-tasks tables', () => {
    expect(normalized).not.toMatch(/alter table (?!weekly_features)/);
    expect(normalized.match(/create table (\w+)/g)).toEqual(['create table weekly_features']);
  });
});
