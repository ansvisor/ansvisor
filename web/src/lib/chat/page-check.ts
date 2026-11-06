import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { readDraftRules } from '@/lib/content/draft-rules-read';
import { readPageQuality, type PageQuality } from '@/lib/content/go-live-gate';
import { qualityBand, qualityPhase } from '@/lib/content/quality';
import type { EeatCheckId } from '@/lib/content/quality-checks';
import {
  readabilitySuggestions,
  trustSuggestions,
  type QualityT,
} from '@/lib/content/quality-suggestions';
import { ruleStatusDetail } from '@/lib/content/rule-words';
import type { ActiveRule } from '@/lib/content/rules';
import type { ChatToolContext } from './registry/define-tool';

/**
 * "Check it against the rules" (CHAT-25 §6 item 3, W4-12b part 2; the
 * owner's 2026-11-05 decision): check_draft_rules, a free READ for every
 * role. A page's rules as the Content Editor checks them (draft-rules-read.ts)
 * and its Quality as the editor scores it (go-live-gate.ts readPageQuality),
 * each open one in the editor's own words: the Rules tab's names and badges,
 * the Quality tab's suggestions and to-dos. No AI: the Quality reads are only
 * the ones the draft has kept (its version card read them as it was made);
 * a read it would have to make leaves Quality out, and says where it shows.
 */

export const CHECK_RULES_TOOL = 'check_draft_rules';

/** The open rules and Quality checks a check lists, at most. */
const MAX_OPEN = 20;

const tRules = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.rules',
});
const tStatus = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.rules.status',
});
const tQuality = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.quality',
}) as unknown as QualityT;
const tTodos = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.quality.todos',
});
const tCheck = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.pageCheck' });

/** E-E-A-T's checks the person does, by their to-do's title in the Quality tab. */
const EEAT_TODOS: Partial<Record<EeatCheckId, string>> = {
  experience: tTodos('experience.title'),
  originalData: tTodos('originalData.title'),
  whoHowWhy: tTodos('whoHowWhy.title'),
  visualProof: tTodos('visualProof.title'),
  checkDate: tTodos('checkDate.title'),
  byline: tTodos('byline.title.pickAuthor'),
};

/** A rule's aim, as the Content Agent is told it ("aim: 1,500 characters"). */
function aimOf(rule: ActiveRule): string | null {
  if (!rule.current) return null;
  return `${rule.current}${rule.unit ? ` ${tRules(`units.${rule.unit}` as 'units.characters')}` : ''}`;
}

/** The check's output, as the model reads it: words, never a number it could make up. */
export interface PageCheck {
  title: string;
  /** Where the page opens: its Open in Content Editor. */
  editor_href: `/dashboard/content/editor/${string}`;
  rules: {
    met: number;
    total: number;
    open: { rule: string; now: string; aim: string | null }[];
  };
  quality:
    | {
        score: number | null;
        scores: { name: string; score: number; band: string }[];
        open: { score: string; check: string; what_to_do: string }[];
      }
    | { not_read: string };
}

/** Quality's scores and its open checks, the biggest gain first, in the editor's words. */
function qualityWords(read: PageQuality): Exclude<PageCheck['quality'], { not_read: string }> {
  const { eeatScore, trustScore, readable, aiChecks } = read.state;
  const named = [
    ['eeat', eeatScore?.score ?? null],
    ['trust', trustScore?.score ?? null],
    ['readability', readable?.score ?? null],
  ] as const;
  const scores = named.flatMap(([name, score]) =>
    score === null
      ? []
      : [
          {
            name: tQuality(`names.${name}`),
            score,
            band: tQuality(`bands.${qualityBand(score)}`),
          },
        ],
  );
  const suggestions = [
    ...readabilitySuggestions(tQuality, readable ?? null),
    ...trustSuggestions(tQuality, trustScore ?? null, new Set(), {
      balanced: aiChecks?.balanced ?? null,
      disclosure: aiChecks?.disclosure ?? null,
      brand: read.brandName,
    }),
  ]
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .map((s) => ({
      score: tQuality(`names.${s.score}`),
      check: s.line,
      what_to_do: s.detail,
    }));
  // E-E-A-T's are the person's own to-dos, as the Quality tab lists them.
  const todos = (eeatScore?.checks ?? []).flatMap((check) => {
    const title = EEAT_TODOS[check.id];
    return title && check.points < check.max
      ? [{ score: tQuality('names.eeat'), check: title, what_to_do: tCheck('todo') }]
      : [];
  });
  return { score: read.score, scores, open: [...suggestions, ...todos].slice(0, MAX_OPEN) };
}

/**
 * The check: null when the draft isn't the workspace's (the tool says so).
 * Quality is read only from what the draft has kept, spending nothing.
 */
export async function checkDraftRules(
  ctx: ChatToolContext,
  draftId: string,
): Promise<PageCheck | { found: false }> {
  const organizationId = ctx.organizationId;
  if (!organizationId) return { found: false };
  const [rules, quality] = await Promise.all([
    readDraftRules({ organizationId, draftId }),
    ctx.run && qualityPhase() >= 1
      ? readPageQuality({
          organizationId,
          draftId,
          runId: ctx.run.id,
          actingUserId: ctx.userId,
          actingRole: ctx.role ?? 'analyst',
          agentRunId: ctx.run.agentRunId,
          scheduleId: ctx.run.scheduleId,
          spend: false,
        })
      : null,
  ]);
  if (!rules) return { found: false };
  const open = rules.checked
    .filter(({ rule, status }) => rule.on && status.state === 'bad')
    .slice(0, MAX_OPEN)
    .map(({ rule, status }) => ({
      rule: tRules(`names.${rule.key}` as 'names.length'),
      now: ruleStatusDetail(tStatus as (key: string) => string, status),
      aim: aimOf(rule),
    }));
  return {
    title: rules.title,
    editor_href: `/dashboard/content/editor/${draftId}`,
    rules: { met: rules.met, total: rules.total, open },
    quality: quality
      ? qualityWords(quality)
      : { not_read: tCheck(qualityPhase() >= 1 ? 'qualityNotKept' : 'qualityOff') },
  };
}

/** What a check leaves for the moves after it: the page's editor link and its rules still open. */
export function pageCheckOf(value: unknown): {
  href: `/dashboard/content/editor/${string}`;
  open: number;
} | null {
  if (!value || typeof value !== 'object') return null;
  const check = value as Partial<PageCheck>;
  const href = check.editor_href;
  const open = check.rules?.open;
  if (typeof href !== 'string' || !href.startsWith('/dashboard/content/editor/')) return null;
  if (!Array.isArray(open)) return null;
  return { href, open: Math.max(open.length, (check.rules?.total ?? 0) - (check.rules?.met ?? 0)) };
}
