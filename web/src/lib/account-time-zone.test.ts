// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * A person's own time zone (Settings › Account, 00468): the column as the
 * migration leaves it (null for Automatic, an IANA name the database knows,
 * theirs alone to change), and the server's read of it: their pick before
 * their browser's zone, else UTC.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { personTimeZone, readChosenTimeZone } = await import('./account-time-zone');

const dir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** A migration's SQL, without its comments. */
function migration(number: string): string {
  const file = files.find((name) => name.startsWith(`${number}_`));
  if (!file) throw new Error(`No migration ${number}`);
  return readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
}

describe('00468: profiles.time_zone', () => {
  const sql = migration('00468');

  it('adds a column that is null for Automatic, 1–64 characters in IANA form', () => {
    expect(sql).toMatch(/alter table public\.profiles\s+add column if not exists time_zone text\b/);
    expect(sql).not.toMatch(/time_zone text not null/);
    expect(sql).toContain('time_zone is null');
    expect(sql).toContain('char_length(time_zone) between 1 and 64');
    const pattern = sql.match(/time_zone ~ '([^']+)'/)?.[1];
    expect(pattern).toBeDefined();
    const iana = new RegExp(pattern!);
    for (const zone of ['UTC', 'Europe/Istanbul', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3']) {
      expect(iana.test(zone), zone).toBe(true);
    }
    for (const zone of ['', '/Istanbul', 'Europe/', 'Europe Istanbul', "x'; drop table"]) {
      expect(iana.test(zone), zone).toBe(false);
    }
  });

  it('refuses a zone the database doesn’t know, on insert and on a change of the column', () => {
    expect(sql).toMatch(/from pg_catalog\.pg_timezone_names \w+ where \w+\.name = new\.time_zone/);
    expect(sql).toContain("errcode = '23514'");
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(
      /create trigger profiles_check_time_zone\s+before insert or update of time_zone on public\.profiles/,
    );
  });

  it('leaves it to the person: no server guard, and only their own row to update', () => {
    // 00228's guard (last redefined by a later migration) keeps role and organization only.
    const guards = files
      .map((file) => readFileSync(`${dir}/${file}`, 'utf8'))
      .filter((text) => text.includes('function public.guard_profile_server_columns'));
    expect(guards.at(-1)).not.toContain('time_zone');
    // A member updates their own profile row and nobody else's ("profiles: own row update").
    const policies = files
      .map((file) => readFileSync(`${dir}/${file}`, 'utf8'))
      .join('\n')
      .match(/create policy "profiles:[^"]*"[^;]*for update[^;]*;/gi);
    expect(policies).toEqual([
      'CREATE POLICY "profiles: own row update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));',
    ]);
    expect(sql).not.toMatch(/policy/i);
  });
});

describe('the person’s time zone on the server', () => {
  const ME = 'aaaaaaaa-0000-4000-8000-000000000001';

  beforeEach(() => {
    db.failures = {};
    db.tables = { profiles: [{ id: ME, time_zone: null }] };
  });

  it('is the browser’s while they picked none (Automatic)', async () => {
    expect(await readChosenTimeZone(ME)).toBeNull();
    expect(await personTimeZone(ME, 'Europe/Istanbul')).toBe('Europe/Istanbul');
    expect(await personTimeZone(ME, undefined)).toBe('UTC');
  });

  it('is their pick over the browser’s', async () => {
    db.tables.profiles[0].time_zone = 'Asia/Tokyo';
    expect(await readChosenTimeZone(ME)).toBe('Asia/Tokyo');
    expect(await personTimeZone(ME, 'Europe/Istanbul')).toBe('Asia/Tokyo');
  });

  it('falls back to the browser’s when the pick can’t be read or isn’t a zone', async () => {
    db.tables.profiles[0].time_zone = 'Mars/Olympus';
    expect(await personTimeZone(ME, 'Europe/Istanbul')).toBe('Europe/Istanbul');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.failures.profiles = { message: 'down' };
    expect(await personTimeZone(ME, 'America/New_York')).toBe('America/New_York');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
