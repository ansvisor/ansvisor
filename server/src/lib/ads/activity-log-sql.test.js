import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
const { secretIn } = await import('./activity.js');

/**
 * Ads' activity log is append-only (00530; ADS-01 §7a acceptance 7). Read
 * from the SQL, as the other migration tests here do: the repository has no
 * database tests.
 */

const root = new URL('../../../../', import.meta.url);
const raw = readFileSync(new URL('supabase/migrations/00530_ads_activity_log.sql', root), 'utf8');
/** Without comments, on one line. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const LOG = 'public\\.ads_activity_log';

/** A function's body, by its name. */
const body = (name) =>
  sql.match(new RegExp(`function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`))[1].trim();

describe('ads_activity_log', () => {
  it('refuses every update, delete and truncate, the service role and the owner included', () => {
    for (const trigger of [
      `append_only before update or delete on ${LOG} for each row`,
      `no_truncate before truncate on ${LOG} for each statement`,
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ads_activity_log_${trigger} execute function ${LOG}_append_only`,
        ),
      );
    }
    // The only way past the raise: a delete, with the purge's flag, of a row past 18 months.
    expect(body('ads_activity_log_append_only').replace(/ /g, '')).toMatch(
      /^beginiftg_op='DELETE'thenifcurrent_setting\('ads\.activity_log_purge',true\)='on'andold\.created_at<now\(\)-interval'18months'thenreturnold;endif;endif;raiseexception/,
    );
    // The service role reads and inserts, nothing more; people read; no policy writes.
    expect(sql).toMatch(
      new RegExp(`revoke all on table ${LOG} from anon, authenticated, service_role;`),
    );
    expect(sql).toMatch(new RegExp(`grant select, insert on table ${LOG} to service_role;`));
    expect(sql).toMatch(new RegExp(`grant select on table ${LOG} to authenticated;`));
    expect(sql).not.toMatch(/grant [^;]*(update|delete|truncate|all)[^;]* on table/);
    expect(sql).not.toMatch(/create policy [^;]* for (insert|update|delete|all)/);
    // No foreign key: deleting a brand or a person never deletes or updates a row.
    expect(sql.match(/create table [^;]*/)[0]).not.toMatch(/references/);
  });

  it('has one purge path: rows past 18 months, for the service role, which nothing calls', () => {
    expect(body('purge_ads_activity_log')).toMatch(
      /^declare v_deleted integer; begin if p_before is null or p_before > now\(\) - interval '18 months' then raise exception .*set_config\('ads\.activity_log_purge', 'on', true\)/,
    );
    expect(sql).toMatch(
      /returns integer language plpgsql security definer set search_path = public/,
    );
    const fn = 'function public\\.purge_ads_activity_log\\(timestamptz, integer\\)';
    expect(sql).toMatch(new RegExp(`revoke all on ${fn} from public, anon, authenticated;`));
    expect(sql).toMatch(new RegExp(`grant execute on ${fn} to service_role;`));
    // No code of the API server or the web reaches it or sets its flag.
    const reaching = ['server/src/', 'web/src/'].flatMap((dir) =>
      readdirSync(new URL(dir, root), { recursive: true })
        .filter((file) => /\.(js|ts|tsx)$/.test(file) && !/\.test\./.test(file))
        .filter((file) =>
          /purge_ads_activity_log|activity_log_purge/.test(
            readFileSync(new URL(dir + file, root), 'utf8'),
          ),
        ),
    );
    expect(reaching).toEqual([]);
  });

  it("lets an Admin read the workspace's rows, anyone else their own, and another workspace none", () => {
    expect(sql).toMatch(new RegExp(`alter table ${LOG} enable row level security;`));
    const policy = sql.match(/create policy "ads_activity_log: own or admin select" (.*?);/)[1];
    expect(policy).toBe(
      "on public.ads_activity_log for select to authenticated using ( organization_id in ( select p.organization_id from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or ads_activity_log.actor_user_id = auth.uid()) ) and ( (brand_id is null and (select public.user_has_all_brands())) or brand_id in (select public.user_brand_ids()) ) )",
    );
  });

  it('refuses the keys of secrets and personal data as the server does, and e-mails', () => {
    const key = new RegExp(raw.match(/@\.key like_regex "([^"]+)" flag "i"/)[1], 'i');
    for (const name of ['accessToken', 'client_secret', 'apiKey', 'email', 'phone', 'lastName']) {
      expect([key.test(name), secretIn({ [name]: 1 })], name).toEqual([true, name]);
    }
    for (const name of ['promptId', 'decision', 'minPaidVolume', 'name', 'domain']) {
      expect([key.test(name), secretIn({ [name]: 1 })], name).toEqual([false, null]);
    }
    expect(raw).toMatch(/@ like_regex "\[\^@\[:space:\]\]\+@/);
  });
});
