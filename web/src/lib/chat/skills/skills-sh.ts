import { API_BASE_URL } from '@/config/api';
import {
  findSkillFolder,
  parseGithubUrl,
  type GithubOptions,
  type GithubRefusalCode,
} from './github';

/**
 * A skill's page on skills.sh (Chat Wave 4 W4-29; owner decision 17:
 * skills.sh is the only directory read). The API reads the page through
 * safe-fetch, on skills.sh only, each redirect too (server/src/lib/
 * skills-sh.js), through the CRON_SECRET internal endpoint, and gives back
 * the skill's repository and name: from its install command (`skills add
 * <repo> --skill <name>`), else its github.com link and the page's path.
 * The skill's folder is found in that repository (github.ts:
 * findSkillFolder), and the import reads it from GitHub, pinned to a
 * commit, as any other. Server only.
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

/** Why a skills.sh page's skill can't be found: the page's reasons, or GitHub's. */
export type SkillsShRefusal = {
  code: SkillsShRefusalCode | GithubRefusalCode;
  detail?: Record<string, string | number>;
};

const refused = (code: SkillsShRefusalCode): { ok: false; refusal: SkillsShRefusal } => ({
  ok: false,
  refusal: { code },
});

/**
 * The github.com link of a skills.sh page's skill, for the workspace it is
 * read for (its 2 pages at once, as Chat's): the skill's own folder when
 * the page names the skill, pinned to the repository's commit. Refusals as
 * values: no GitHub link on it, a timeout, unreachable (or busy), any other
 * reason the page couldn't be read, or GitHub's (no skill of that name in
 * the repository…). Throws only when the API can't be asked at all.
 * `options.fetch` asks the API and GitHub both, in tests.
 */
export async function findSkillsShSource(
  link: string,
  organizationId: string,
  options: GithubOptions = {},
): Promise<{ ok: true; url: string } | { ok: false; refusal: SkillsShRefusal }> {
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
    const source = typeof body?.source === 'string' && body.source ? body.source : null;
    if (!source) return refused('skills_sh_no_github');
    const skill = typeof body?.skill === 'string' && body.skill ? body.skill : null;
    // A link to the skill's folder or SKILL.md is the skill's already.
    if (!skill || parseGithubUrl(source)?.path !== '') return { ok: true, url: source };
    return findSkillFolder(source, skill, options);
  }
  const code = body?.code;
  if (code === 'timeout') return refused('page_timeout');
  if (code === 'unreachable' || code === 'busy') return refused('page_unreachable');
  if (typeof code === 'string' && code !== 'failed') return refused('page_failed');
  throw new Error(`Internal skill-source endpoint returned ${res.status}`);
}
