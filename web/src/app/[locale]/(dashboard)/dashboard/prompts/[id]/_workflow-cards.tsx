'use client';

/**
 * Prompt workflow section on the prompt detail page: a notes thread, the
 * target URLs list, and content opportunities. The work-status picker lives in
 * the page header (next to the Active badge); these three cards carry the
 * collaboration surface.
 */

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ContentOpportunity } from '@/types';
import { useCallback, useState } from 'react';
import { IMPACT_COLORS } from '@/components/content/opportunity-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  CheckCircle2,
  FileText,
  Lightbulb,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  addPromptNote,
  addPromptTargetUrl,
  deletePromptNote,
  deletePromptTargetUrl,
  type PromptNote,
  type PromptTargetUrl,
} from '@/lib/actions/prompt-workflow';

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Cited-status badge for a target URL. Distinguishes "cited after we started
 * targeting it" (the win) from "was already cited before targeting".
 */
function CitedBadge({ target }: { target: PromptTargetUrl }) {
  const t = useTranslations('prompts.detail.targets');
  if (target.citedCount === 0) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground whitespace-nowrap"
      >
        {t('notCited')}
      </Badge>
    );
  }
  const alreadyCited =
    target.firstCitedAt !== null && new Date(target.firstCitedAt) < new Date(target.createdAt);
  const tooltip = [
    t('citedIn', { count: target.citedCount }),
    target.firstCitedAt ? t('first', { date: formatShortDate(target.firstCitedAt) }) : null,
    target.lastCitedAt ? t('last', { date: formatShortDate(target.lastCitedAt) }) : null,
    alreadyCited ? t('alreadyCited') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Badge
      variant="outline"
      title={tooltip}
      className={cn(
        'shrink-0 gap-1 text-[10px] whitespace-nowrap',
        'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      )}
    >
      <CheckCircle2 className="h-3 w-3" />
      {t('cited', { count: target.citedCount })}
    </Badge>
  );
}

/** A note's time on the viewer's clock, written as the answer times above it. */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
}

export function NotesCard({
  promptId,
  notes,
  onNotesChange,
  canManage,
}: {
  promptId: string;
  notes: PromptNote[];
  onNotesChange: (notes: PromptNote[]) => void;
  canManage: boolean;
}) {
  const t = useTranslations('prompts.detail.notes');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const result = await addPromptNote(promptId, body);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      onNotesChange([result.note, ...notes]);
      setDraft('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('addFailed'));
    } finally {
      setSaving(false);
    }
  }, [draft, promptId, notes, onNotesChange, t]);

  const handleDelete = (note: PromptNote) => {
    onNotesChange(notes.filter((n) => n.id !== note.id));
    deletePromptNote(note.id).catch(() => {
      onNotesChange(notes);
      toast.error(t('deleteFailed'));
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="h-4 w-4" />
          {t('title')}
          {notes.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {notes.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="space-y-2">
            <Textarea
              placeholder={t('placeholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={2000}
              className="text-sm"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{draft.length}/2000</p>

              <Button
                size="sm"
                className="gap-2"
                onClick={handleAdd}
                disabled={saving || !draft.trim()}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {t('add')}
              </Button>
            </div>
          </div>
        )}
        {notes.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {canManage ? t('empty') : t('emptyReadOnly')}
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="group rounded-lg border bg-muted/20 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {note.authorName ?? t('unknownAuthor')} · {formatNoteDate(note.createdAt)}
                  </p>
                  {canManage && (
                    <button
                      type="button"
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={() => handleDelete(note)}
                      aria-label={t('delete')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TargetUrlsCard({
  promptId,
  urls,
  onUrlsChange,
  canManage,
}: {
  promptId: string;
  urls: PromptTargetUrl[];
  onUrlsChange: (urls: PromptTargetUrl[]) => void;
  canManage: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const t = useTranslations('prompts.detail.targets');

  const handleAdd = useCallback(async () => {
    const value = draft.trim();
    if (!value) return;
    setSaving(true);
    try {
      const result = await addPromptTargetUrl(promptId, value);
      if ('error' in result) {
        setUrlError(result.error);
        return;
      }
      onUrlsChange([...urls, result.targetUrl]);
      setDraft('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('addFailed'));
    } finally {
      setSaving(false);
    }
  }, [draft, promptId, urls, onUrlsChange, t]);

  const handleDelete = (target: PromptTargetUrl) => {
    onUrlsChange(urls.filter((u) => u.id !== target.id));
    deletePromptTargetUrl(target.id).catch(() => {
      onUrlsChange(urls);
      toast.error(t('removeFailed'));
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4" />
          {t('title')}
          {urls.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {urls.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="https://example.com/blog/comparison-post"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {t('add')}
            </Button>
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          </div>
        )}
        {urls.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {canManage ? t('empty') : t('emptyReadOnly')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {urls.map((target) => (
              <li
                key={target.id}
                className="group flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
              >
                <a
                  href={target.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm hover:underline"
                  title={target.url}
                >
                  <span className="truncate">{target.url.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </a>
                <CitedBadge target={target} />
                {canManage && (
                  <button
                    type="button"
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => handleDelete(target)}
                    aria-label={t('remove')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const OPPORTUNITY_PREVIEW_LIMIT = 5;

export function ContentOpportunitiesCard({
  promptId,
  opportunities,
  total,
  loading,
  failed,
}: {
  promptId: string;
  opportunities: ContentOpportunity[];
  total: number;
  loading: boolean;
  failed?: boolean;
}) {
  const t = useTranslations('content');
  const tCard = useTranslations('prompts.detail.opportunities');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Lightbulb className="h-4 w-4" />
          {tCard('title')}
          {total > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {total}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{tCard('description')}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{tCard('loadFailed')}</p>
        ) : opportunities.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{tCard('empty')}</p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {opportunities.map((opp) => (
                <li
                  key={opp.id}
                  className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <Link
                    href={`/dashboard/content/${opp.id}`}
                    title={opp.title}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {opp.title}
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('text-xs', IMPACT_COLORS[opp.impact])}>
                      {t(`impact.${opp.impact}` as 'impact.high' | 'impact.medium' | 'impact.low')}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      title={t(`typeHint.${opp.type}` as 'typeHint.owned' | 'typeHint.earned')}
                    >
                      {t(`type.${opp.type}` as 'type.owned' | 'type.earned')}
                    </Badge>
                    {opp.brief && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] gap-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                      >
                        <FileText className="h-3 w-3" />
                        {tCard('briefReady')}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {total > OPPORTUNITY_PREVIEW_LIMIT && (
              <div className="flex justify-center pt-2">
                <Link
                  href={`/dashboard/content?prompt=${encodeURIComponent(promptId)}&status=new`}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {tCard('viewAll', { total })}
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
