// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPETITOR_TYPE_MAX_LENGTH, DEFAULT_COMPETITOR_TYPES } from './competitor-types';

/**
 * Competitor types' migration (00542): a nullable column and its check, and
 * nothing else, so it applies in seconds and again without harm. Read from
 * the SQL, as the repository has no database tests: supabase/schema.sql is
 * every migration in order.
 */

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const SCHEMA = readFileSync(root('supabase/schema.sql'), 'utf8');

/** SQL on one line, its comments left out. */
const flat = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function migration(number: string): string {
  const parts = SCHEMA.split(/^-- migrations\/(\S+\.sql)$/m);
  const at = parts.findIndex((part) => part.startsWith(`${number}_`));
  if (at < 0) throw new Error(`No migration ${number}`);
  return flat(parts[at + 1]);
}

const sql = migration('00542');
/** Its statements, without the comment on the column (its text names words like "update"). */
const statements = sql
  .replace(/comment on column [\w.]+ is '(?:[^']|'')*';/g, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

describe('00542: competitors.type', () => {
  it('adds a nullable text column, again without harm', () => {
    expect(sql).toContain('alter table public.competitors add column if not exists type text;');
    expect(sql).not.toMatch(/type text (not null|default)/);
  });

  it('keeps a type trimmed and at most 40 characters, dropping the check before adding it', () => {
    expect(sql).toContain(
      'alter table public.competitors drop constraint if exists competitors_type_check; ' +
        'alter table public.competitors add constraint competitors_type_check ' +
        'check (type is null or (char_length(type) between 1 and 40 and type = btrim(type)));',
    );
    expect(COMPETITOR_TYPE_MAX_LENGTH).toBe(40);
    for (const key of DEFAULT_COMPETITOR_TYPES) {
      expect(key.length).toBeLessThanOrEqual(COMPETITOR_TYPE_MAX_LENGTH);
      expect(key).toBe(key.trim());
    }
  });

  it('is schema only: no row written, no index built, no row rule changed', () => {
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(update|insert|delete|create (unique )?index)\b/i);
      expect(statement).not.toMatch(/\b(policy|grant|revoke)\b/i);
    }
    expect(statements).toEqual([
      'alter table public.competitors add column if not exists type text',
      'alter table public.competitors drop constraint if exists competitors_type_check',
      expect.stringMatching(
        /^alter table public\.competitors add constraint competitors_type_check/,
      ),
      "notify pgrst, 'reload schema'",
    ]);
  });

  it('says what the column holds', () => {
    expect(sql).toMatch(/comment on column public\.competitors\.type is '.*null for no type\.'/);
  });
});
