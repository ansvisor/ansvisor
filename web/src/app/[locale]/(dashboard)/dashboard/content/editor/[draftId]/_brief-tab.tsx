'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingDots } from '@/components/ui/loading-dots';
import { saveDraftBrief } from '@/lib/actions/content-drafts';
import { MAX_BRIEF_SECTIONS, builtFromCount, type DraftBrief } from '@/lib/content/brief';
import type { DraftMethod } from '@/lib/content/drafts';
import { platformNames } from '@/lib/content/impact';
import { pagePath } from '@/lib/content/overlap';
import { wordsForLength } from '@/lib/content/rules';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RunCard } from './_run-card';
import { WorkingDots } from './_working-dots';

/**
 * Rewrite from brief: the Content Agent writes the page again from the brief
 * (a new page), or suggests changes from it (a live page), as Start's agent
 * does (content-writer.js).
 */
export interface AgentRewrite {
  run: () => void;
  running: boolean;
  /** Why it can't run now (open suggestions to decide first), or null. */
  blocked: string | null;
}

/** The brief as the panel holds it: read once the tab opens. */
export type BriefState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; brief: DraftBrief | null };

/**
 * The Brief segment (Content Editor CE-007, spec §10; v1.1 CE-030): a card
 * saying whether there is a brief, with Run Agent to write it from the
 * sources kept (Rebuild brief once there is one), then the page type and
 * target address, the goal, audience and length (in characters, and about
 * as many words), and the outline with each H2's fan-out and platform. Edit
 * brief changes it by hand. Until the draft has a brief, the opportunity's
 * brief it started from is shown. Rewrite from brief hands the page to the
 * Content Agent with it.
 */
export function BriefTab({
  draftId,
  state,
  pageType,
  length,
  sourceUrl,
  method,
  rebuilding,
  onRebuild,
  onRetry,
  onSaved,
  rewrite,
  dataLine,
  blocked = null,
}: {
  draftId: string;
  state: BriefState;
  pageType: string | null;
  /** The length the rules ask for (CE-009). */
  length: number;
  sourceUrl: string | null;
  method: DraftMethod;
  rebuilding: boolean;
  onRebuild: () => void;
  onRetry: () => void;
  onSaved: (brief: DraftBrief) => void;
  /** Absent once the page is ready or published. */
  rewrite?: AgentRewrite;
  /** "Uses your data", under Run Agent's card (v1.1 CE-032). */
  dataLine?: React.ReactNode;
  /** Why Run Agent waits (another agent run from the page), or null. */
  blocked?: string | null;
}) {
  const t = useTranslations('contentEditor.editor.brief');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const [editing, setEditing] = useState(false);
  // A brief edited by hand is rebuilt only once the person says so.
  const [confirming, setConfirming] = useState(false);
  // The agent writes over the page (or suggests changes) only once the person says so.
  const [confirmingRewrite, setConfirmingRewrite] = useState(false);

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-8" aria-busy="true">
        <LoadingDots className="text-muted-foreground" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('loadError')}
        <button type="button" className="font-medium underline" onClick={onRetry}>
          {t('retry')}
        </button>
      </p>
    );
  }

  const brief = state.brief;
  if (editing) {
    return (
      <BriefEditor
        draftId={draftId}
        brief={brief ?? EMPTY_BRIEF}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          onSaved(saved);
        }}
      />
    );
  }

  const typeLabel = pageType && (tTypes.has(pageType) ? tTypes(pageType) : pageType);
  // Nothing written yet: Run Agent writes it. Once it is, Rebuild brief.
  const empty = !brief || (!brief.goal && !brief.audience && brief.outline.length === 0);
  const rebuild = () => (brief?.origin === 'edit' && !empty ? setConfirming(true) : onRebuild());

  return (
    <div className="space-y-4 text-sm">
      <RunCard
        title={empty ? t('status.empty') : t('status.ready', { count: brief?.outline.length ?? 0 })}
        detail={empty ? t('status.emptyDetail') : undefined}
        action={
          <Button
            size="sm"
            variant={empty ? 'default' : 'outline'}
            className="shrink-0"
            disabled={rebuilding || confirming || blocked !== null}
            onClick={rebuild}
          >
            {rebuilding && <WorkingDots className="ml-0" />}
            {empty ? t('run') : t('rebuild')}
          </Button>
        }
        info={t('info')}
        data={dataLine}
        blocked={rebuilding ? null : blocked}
      >
        <p className="text-[11px] text-muted-foreground">{t('usage')}</p>
        {/* Under the card that asked, not past the outline. */}
        {confirming && (
          <div role="alert" className="space-y-2 rounded-md border px-3 py-2 text-xs">
            <p>{t('rebuildEdited')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                  onRebuild();
                }}
              >
                {t('rebuildAnyway')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t('keepEdited')}
              </Button>
            </div>
          </div>
        )}
      </RunCard>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t('pageType')}</dt>
        <dd className={cn(!typeLabel && 'text-muted-foreground')}>{typeLabel || t('notSet')}</dd>
        <dt className="text-muted-foreground">{t('targetUrl')}</dt>
        <dd className="min-w-0 truncate" title={sourceUrl ?? undefined}>
          {sourceUrl ? pagePath(sourceUrl) : t('newPage')}
        </dd>
        <dt className="text-muted-foreground">{t('goal')}</dt>
        <dd className={cn(!brief?.goal && 'text-muted-foreground')}>
          {brief?.goal || t('notSet')}
        </dd>
        <dt className="text-muted-foreground">{t('audience')}</dt>
        <dd className={cn(!brief?.audience && 'text-muted-foreground')}>
          {brief?.audience || t('notSet')}
        </dd>
        <dt className="text-muted-foreground">{t('length')}</dt>
        <dd>
          {t('lengthValue', {
            count: formatNumber(length),
            words: formatNumber(wordsForLength(length)),
          })}
          <span className="block text-muted-foreground">
            {brief?.citedLength
              ? t('lengthFromCited', {
                  count: formatNumber(brief.citedLength.characters),
                  pages: brief.citedLength.pages,
                })
              : t('lengthFrom')}
          </span>
        </dd>
      </dl>

      {brief && brief.outline.length > 0 ? (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('outline')}{' '}
            <span className="font-normal">· {formatNumber(brief.outline.length)}</span>
          </h4>
          <ol className="space-y-1.5">
            {brief.outline.map((section, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                <p className="text-xs font-medium">
                  <span className="mr-1.5 text-muted-foreground">H2</span>
                  {section.heading}
                </p>
                {section.keyPoints.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {section.keyPoints.map((point, j) => (
                      <li key={j}>{point}</li>
                    ))}
                  </ul>
                )}
                {section.fanout && (
                  <p className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                    <span className="truncate" title={section.fanout}>
                      {t('answers', { fanout: section.fanout })}
                    </span>
                    {section.platform && (
                      <span className="shrink-0 text-muted-foreground">
                        · {platformNames([section.platform])[0]}
                      </span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {empty ? t('empty') : t('emptyOutline')}
        </p>
      )}

      {brief && brief.keywords.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t('keywords')}</h4>
          <div className="flex flex-wrap gap-1">
            {brief.keywords.map((keyword) => (
              <span key={keyword} className="rounded-md border px-1.5 py-0.5 text-[11px]">
                {keyword}
              </span>
            ))}
          </div>
        </section>
      )}

      {brief && !empty && (
        <p className="text-[11px] text-muted-foreground">
          {brief.origin === 'opportunity'
            ? t('fromOpportunity')
            : brief.origin === 'edit'
              ? t('edited')
              : t('builtFrom', {
                  count: builtFromCount(brief),
                  date: brief.builtAt ? formatDateTime(brief.builtAt) : '',
                })}
        </p>
      )}

      {rewrite &&
        brief &&
        brief.outline.length > 0 &&
        (confirmingRewrite ? (
          <div role="alert" className="space-y-2 rounded-md border px-3 py-2 text-xs">
            <p>{t(`rewrite.confirm.${method}`)}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmingRewrite(false);
                  rewrite.run();
                }}
              >
                {t('rewrite.start')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingRewrite(false)}>
                {t('rewrite.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="w-full"
              disabled={rewrite.running || rewrite.blocked !== null || rebuilding}
              onClick={() => setConfirmingRewrite(true)}
            >
              {rewrite.running ? <WorkingDots className="ml-0" /> : <Bot className="h-3.5 w-3.5" />}
              {t(`rewrite.button.${method}`)}
            </Button>
            {/* Why it waits, written out (v1.1 CE-031), not only on hover. */}
            {!rewrite.running && rewrite.blocked && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{rewrite.blocked}</p>
            )}
          </div>
        ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={rebuilding} onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
          {t('edit')}
        </Button>
      </div>
    </div>
  );
}

/** What Edit brief starts from when the draft has no brief: H2s added by hand. */
const EMPTY_BRIEF: DraftBrief = {
  goal: '',
  audience: '',
  outline: [],
  keywords: [],
  origin: 'edit',
  builtAt: null,
  builtFrom: null,
};

/** Edit brief: goal, audience, the outline's sections and key points, keywords. */
function BriefEditor({
  draftId,
  brief,
  onCancel,
  onSaved,
}: {
  draftId: string;
  brief: DraftBrief;
  onCancel: () => void;
  onSaved: (brief: DraftBrief) => void;
}) {
  const t = useTranslations('contentEditor.editor.brief.editor');
  const [goal, setGoal] = useState(brief.goal);
  const [audience, setAudience] = useState(brief.audience);
  const [sections, setSections] = useState(
    brief.outline.map((s) => ({ ...s, points: s.keyPoints.join('\n') })),
  );
  const [keywords, setKeywords] = useState(brief.keywords.join(', '));
  const [saving, setSaving] = useState(false);

  const update = (index: number, change: Partial<(typeof sections)[number]>) =>
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveDraftBrief(draftId, {
        ...brief,
        goal: goal.trim(),
        audience: audience.trim(),
        outline: sections
          .filter((s) => s.heading.trim())
          .map((s) => ({
            heading: s.heading.trim(),
            keyPoints: s.points
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean),
            fanout: s.fanout,
            platform: s.platform,
          })),
        keywords: [
          ...new Set(
            keywords
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          ),
        ],
      });
      toast.success(t('saved'));
      onSaved(saved);
    } catch (err) {
      console.error('Failed to save the brief:', err);
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('goal')}</span>
        <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={500} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('audience')}</span>
        <Input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={500} />
      </label>
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">{t('outline')}</span>
        {sections.map((section, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">H2</span>
              <Input
                value={section.heading}
                onChange={(e) => update(i, { heading: e.target.value })}
                aria-label={t('heading', { index: i + 1 })}
                maxLength={300}
                className="h-8"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('remove', { index: i + 1 })}
                onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              value={section.points}
              onChange={(e) => update(i, { points: e.target.value })}
              aria-label={t('points', { index: i + 1 })}
              placeholder={t('pointsPlaceholder')}
              rows={2}
              className="text-xs"
            />
          </div>
        ))}
        {sections.length < MAX_BRIEF_SECTIONS && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSections((prev) => [
                ...prev,
                { heading: '', keyPoints: [], points: '', fanout: null, platform: null },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addSection')}
          </Button>
        )}
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('keywords')}</span>
        <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving && <LoadingDots />}
          {t('save')}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
