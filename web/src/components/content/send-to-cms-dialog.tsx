'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Textarea } from '@/components/ui/textarea';
import type { ContentAuthor } from '@/lib/content/authors';
import {
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  cmsFields,
  cmsFieldsProblem,
  cmsPage,
  cmsPageProblem,
  type CmsFields,
} from '@/lib/content/cms-send';
import {
  readDraftCms,
  sendPagesToCms,
  type CmsSendError,
  type DraftCms,
} from '@/lib/content/cms-send-client';
import { exportPlaceholders, pageFields, titlePlaceholders } from '@/lib/content/ready-to-publish';

/**
 * Send to CMS (#1331): the page to the brand's webhook, for the workspace's
 * CMS or automation to publish. Its slug and meta are filled from the page,
 * or what the draft kept, and editable; they stay on the draft. The page
 * goes as Export makes it ready (CE-057): no placeholder goes, so they are
 * filled first. From the editor's header and a Library row; rendered only
 * while open, on the page as it was then.
 */
export function SendDialog({
  draftId,
  brandId,
  title,
  html,
  sourceUrl,
  author,
  teamByline,
  byline,
  onFillNow,
  onClose,
}: {
  draftId: string;
  brandId: string;
  title: string;
  /** The page as Copy HTML gives it (publishableHtml). */
  html: string;
  sourceUrl: string | null;
  author: ContentAuthor | null;
  /** The team byline; empty while the authors aren't read. */
  teamByline: string;
  /** The byline line the brand puts in the content, or null. */
  byline: string | null;
  /** Goes to the first placeholder, to fill it. */
  onFillNow: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.send');
  const tFailure = useTranslations('apiFailure');
  const format = useFormatter();
  const page = useMemo(
    () => pageFields({ title, html, sourceUrl, author, teamByline }),
    [title, html, sourceUrl, author, teamByline],
  );
  const placeholders = useMemo(
    () => exportPlaceholders(html) + titlePlaceholders(title, html),
    [html, title],
  );
  const pageProblem = useMemo(() => cmsPageProblem(title, html), [title, html]);
  // Undefined while the draft's kept fields are read; null when they couldn't be.
  const [kept, setKept] = useState<DraftCms | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [fields, setFields] = useState<CmsFields>(() => cmsFields(page, null));
  // The fields the person changed: a ref, so the read that comes in after a
  // change sees it. The rest take what the draft kept (its slug above all,
  // or the CMS could get the page twice).
  const touched = useRef(new Set<keyof CmsFields>());
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<
    { code: CmsSendError; field: string | null } | { status: number } | { failed: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    readDraftCms(draftId)
      .then((read) => {
        if (cancelled) return;
        setKept(read);
        setRetrying(false);
        // What the draft kept, in each field the person hasn't changed.
        if (!read) return;
        const fromKept = cmsFields(page, read.fields);
        setFields((prev) => ({
          slug: touched.current.has('slug') ? prev.slug : fromKept.slug,
          metaTitle: touched.current.has('metaTitle') ? prev.metaTitle : fromKept.metaTitle,
          metaDescription: touched.current.has('metaDescription')
            ? prev.metaDescription
            : fromKept.metaDescription,
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setKept(null);
        setRetrying(false);
      });
    return () => {
      cancelled = true;
    };
    // Read as it opens, and on Try again; the fields it fills are the person's after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, attempt]);

  const change = (key: keyof CmsFields, value: string) => {
    touched.current.add(key);
    setProblem(null);
    setFields((prev) => ({ ...prev, [key]: value }));
  };
  const wrong = cmsFieldsProblem(fields);
  // An empty slug (a title in another script gives none) asks for one, not a fix.
  const slugEmpty = fields.slug.trim() === '';
  const slugWrong = wrong === 'slug' && !slugEmpty;

  const send = async () => {
    setSending(true);
    setProblem(null);
    const result = await sendPagesToCms(brandId, [
      cmsPage({ draftId, title, html, fields, page, byline }),
    ]);
    setSending(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    const [delivery] = result.deliveries;
    if (delivery?.status === 'failed') {
      // What the webhook answered when it refused the page; else why it
      // failed: not reached, or the workflow's own reason in a callback
      // after it took the page (a 2xx).
      const refused =
        delivery.http_status && (delivery.http_status < 200 || delivery.http_status > 299);
      setProblem(
        refused
          ? { status: delivery.http_status! }
          : { failed: delivery.error ?? t('errors.failed') },
      );
      return;
    }
    toast.success(t('sent'));
    onClose();
  };

  const problemText = (shown: NonNullable<typeof problem>) => {
    if ('status' in shown) return t('errors.webhookStatus', { status: shown.status });
    if ('failed' in shown) return t('errors.webhookFailed', { reason: shown.failed });
    const { code, field } = shown;
    if (code === 'session' || code === 'workspace' || code === 'busy') return tFailure(code);
    // The server names the path ("pages.0.slug"); the field is its last part.
    if (code === 'invalid' && field) {
      return t('errors.invalidField', { field: field.split('.').pop() ?? 'other' });
    }
    return t(`errors.${code}`);
  };

  const live = kept?.publishedUrl ?? null;
  const last = kept?.last ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {pageProblem && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="min-w-0 flex-1">{t(pageProblem)}</span>
          </div>
        )}

        {placeholders > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="min-w-0 flex-1">{t('placeholders', { count: placeholders })}</span>
            <Button size="sm" variant="outline" onClick={onFillNow}>
              {t('fillNow')}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('fields.title')}</p>
            <p className="text-sm [overflow-wrap:anywhere]">{title.trim() || '—'}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cms-slug">{t('fields.slug')}</Label>
            <Input
              id="cms-slug"
              required
              value={fields.slug}
              onChange={(e) => change('slug', e.target.value)}
              aria-invalid={slugWrong || undefined}
              aria-describedby="cms-slug-hint"
            />
            <p
              id="cms-slug-hint"
              className={
                slugWrong
                  ? 'text-xs text-red-700 dark:text-red-400'
                  : 'text-xs text-muted-foreground'
              }
            >
              {slugWrong
                ? t('fields.slugInvalid')
                : slugEmpty
                  ? t('fields.slugEmpty')
                  : t('fields.slugHint')}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cms-meta-title">{t('fields.metaTitle')}</Label>
            <Input
              id="cms-meta-title"
              value={fields.metaTitle}
              maxLength={META_TITLE_MAX}
              onChange={(e) => change('metaTitle', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cms-meta-description">{t('fields.metaDescription')}</Label>
            <Textarea
              id="cms-meta-description"
              value={fields.metaDescription}
              maxLength={META_DESCRIPTION_MAX}
              rows={3}
              onChange={(e) => change('metaDescription', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('fields.characters', { count: fields.metaDescription.trim().length })}
            </p>
          </div>
        </div>

        {(live || last) && (
          <p className="text-xs text-muted-foreground">
            {live ? (
              <>
                {t('live')}{' '}
                <a
                  href={live}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-foreground underline underline-offset-2 [overflow-wrap:anywhere]"
                >
                  {live}
                </a>
              </>
            ) : (
              last &&
              t(`last.${last.status}`, {
                when: format.dateTime(new Date(last.at), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            )}
          </p>
        )}

        {/* Unread, a page sent before under another slug could land in the
            CMS twice: the send waits for the read (as the bulk send does). */}
        {kept === null && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-red-700 dark:text-red-400"
          >
            <span className="min-w-0 flex-1">{t('readFailed')}</span>
            {/* Kept in place while it reads again, so focus stays on it. */}
            <Button
              size="sm"
              variant="outline"
              disabled={retrying}
              aria-label={t('retry')}
              onClick={() => {
                setRetrying(true);
                setAttempt((n) => n + 1);
              }}
            >
              {retrying ? <LoadingDots /> : t('retry')}
            </Button>
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problemText(problem)}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={sending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={
              sending || pageProblem !== null || placeholders > 0 || wrong !== null || !kept
            }
            onClick={() => void send()}
          >
            {sending && <LoadingDots className="mr-1" />}
            {sending ? t('sending') : t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
