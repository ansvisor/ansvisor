import { API_BASE_URL } from '@/config/api';

/**
 * A skill's page on skills.sh (Chat Wave 4 W4-29; owner decision 17:
 * skills.sh is the only directory read). The API reads the page through
 * safe-fetch, on skills.sh only, each redirect too (server/src/lib/
 * skills-sh.js), through the CRON_SECRET internal endpoint, and gives back
 * the skill's github.com link on it: the import then reads the skill from
 * GitHub, pinned to a commit, as any other (github.ts). Server only.
 */

/** The directory's hosts. */
export const SKILLS_SH_HOSTS: ReadonlySet<string> = new Set(['skills.sh', 'www.skills.sh']);

/** Whether a link is a skills.sh page: https, its own host, no sign-in or port. */
export function isSkillsShUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    SKILLS_SH_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port
  );
}

export type SkillsShRefusalCode =
  | 'skills_sh_no_github'
  | 'page_timeout'
  | 'page_unreachable'
  | 'page_failed';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const refused = (code: SkillsShRefusalCode) => ({ ok: false as const, refusal: { code } });

/**
 * The github.com link on a skills.sh page, for the workspace it is read
 * for (its 2 pages at once, as Chat's). Refusals as values: no GitHub link
 * on it, a timeout, unreachable (or busy), or any other reason the page
 * couldn't be read. Throws only when the API can't be asked at all.
 */
export async function findSkillsShSource(
  link: string,
  organizationId: string,
  options: { fetch?: Fetcher } = {},
): Promise<{ ok: true; url: string } | { ok: false; refusal: { code: SkillsShRefusalCode } }> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error('CRON_SECRET must be configured for reading skills.sh pages');
  const res = await (options.fetch ?? fetch)(
    `${API_BASE_URL}/api/internal/chat/pages/skill-source`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: link.trim(), orgId: organizationId }),
      cache: 'no-store',
    },
  );
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) {
    return typeof body?.source === 'string' && body.source
      ? { ok: true, url: body.source }
      : refused('skills_sh_no_github');
  }
  const code = body?.code;
  if (code === 'timeout') return refused('page_timeout');
  if (code === 'unreachable' || code === 'busy') return refused('page_unreachable');
  if (typeof code === 'string' && code !== 'failed') return refused('page_failed');
  throw new Error(`Internal skill-source endpoint returned ${res.status}`);
}
