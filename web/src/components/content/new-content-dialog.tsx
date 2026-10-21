'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  createContentDraft,
  getContentOverlap,
  getContentStartOptions,
  importContentPage,
  sendContentDraftToActionCenter,
} from '@/lib/actions/content-drafts';
import { MAX_ATTACHMENT_BYTES, textToHtml } from '@/lib/content/attachments';
import { cleanHtml } from '@/lib/content/clean-html';
import {
  contentEditorPath,
  type ContentOverlap,
  type DraftMethod,
  type DraftSource,
  type DraftStartOptions,
  type PageImportError,
  type PageType,
} from '@/lib/content/drafts';
import { DOCUMENT_ACCEPT, readDocumentFile } from '@/lib/content/import-document';
import {
  adviseOverlap,
  pagePath,
  type OverlapChoice,
  type OverlapOption,
} from '@/lib/content/overlap';
import { SITE_PAGE_TYPES, detectPageType, type SiteType } from '@/lib/content/page-types';
import {
  fileTitle,
  startPageType,
  summarizeContent,
  type ContentSummary,
} from '@/lib/content/start';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type SourceKind = 'opportunity' | 'prompt' | 'topic';
const SOURCE_KINDS: SourceKind[] = ['opportunity', 'prompt', 'topic'];

interface PickerItem {
  value: string;
  label: string;
  meta?: string;
  /** The page's title, when it isn't the label (an opportunity's brief title). */
  pageTitle?: string;
}

/** Content brought to optimize: cleaned HTML, what it holds, and where it came from. */
interface BroughtContent extends ContentSummary {
  html: string;
  /** The file's name; none for a paste. */
  fileName?: string;
  /** The page's address, for content read from a URL. */
  sourceUrl?: string;
  imagesRemoved: number;
}

/** Where content to optimize comes from. */
type ContentFrom = 'url' | 'paste' | 'file';

/** Where Start's first page type came from, if it was read from somewhere. */
type DetectedFrom = 'title' | 'content' | 'page' | null;

/** What Start opens the editor with. */
interface StartChoice {
  method: DraftMethod;
  title: string;
  source: DraftSource;
  bodyHtml?: string;
  /** The page the content was read from, for content brought by URL. */
  sourceUrl?: string;
  pageType: PageType;
  detectedFrom: DetectedFrom;
  /** The person picked the type from the chips; otherwise it follows the page. */
  picked: boolean;
  /** The page type for a new page, to go back to from optimizing an existing one. */
  newPageType: { pageType: PageType; detectedFrom: DetectedFrom; picked: boolean };
  /** The overlap check's pick: write the new page, or optimize an existing one. */
  choice: OverlapChoice;
}

/** Who does the page (Start, CE-015): the person, the Content Agent, or the team. */
type Who = 'me' | 'agent' | 'team';
const WHO: Who[] = ['me', 'agent', 'team'];

/** The overlap check for one source: null while it runs. */
interface OverlapRead {
  key: string;
  overlap: ContentOverlap | null;
  failed: boolean;
}

/**
 * New content and Start (Content Editor CE-003, CE-015; spec §5, §9). First,
 * how the page starts: a new page from an opportunity, a tracked prompt or a
 * topic, or content to optimize, pasted or from a file. Then Start: the page
 * type, picked first from what the title or content shows, and Open editor.
 */
export function NewContentDialog({
  open,
  onOpenChange,
  brandId,
  siteType,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  siteType: SiteType;
  /** A draft was sent to the Action Center: the Library lists it. */
  onSent?: () => void;
}) {
  const t = useTranslations('contentEditor.newContent');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const router = useRouter();

  const [options, setOptions] = useState<DraftStartOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [method, setMethod] = useState<DraftMethod>('create');
  const [kind, setKind] = useState<SourceKind>('opportunity');
  const [picked, setPicked] = useState<PickerItem | null>(null);
  const [from, setFrom] = useState<ContentFrom>('url');
  const [pageUrl, setPageUrl] = useState('');
  const [urlError, setUrlError] = useState<{ code: PageImportError; status?: number } | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [content, setContent] = useState<BroughtContent | null>(null);
  const [reading, setReading] = useState(false);
  const [start, setStart] = useState<StartChoice | null>(null);
  const [opening, setOpening] = useState(false);
  const [who, setWho] = useState<Who>('me');
  const [overlapRead, setOverlapRead] = useState<OverlapRead | null>(null);
  const [overlapAttempt, setOverlapAttempt] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Each opening starts over and reads what there is to start from.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getContentStartOptions(brandId)
      .then((read) => {
        if (cancelled) return;
        setOptions(read);
        setOptionsFailed(false);
      })
      .catch((err) => {
        console.error('Failed to load what New content starts from:', err);
        if (!cancelled) setOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, brandId, attempt]);

  // Start checks the pages that already answer a new page's prompts. Content
  // brought to optimize has no prompts to check. A page type picked in Start
  // keeps the same source, so the check runs once per source.
  const startSource = start?.source;
  const overlapKey = startSource && startSource.kind !== 'content' ? sourceKey(startSource) : null;
  useEffect(() => {
    if (!startSource || startSource.kind === 'content') return;
    const key = sourceKey(startSource);
    let cancelled = false;
    getContentOverlap(brandId, startSource)
      .then((overlap) => {
        if (cancelled) return;
        setOverlapRead({ key, overlap, failed: false });
        // The recommended option is picked first.
        const recommended = adviseOverlap(overlap).options[0];
        if (recommended) setStart((s) => (s ? withChoice(s, recommended.choice, siteType) : s));
      })
      .catch((err) => {
        console.error('Failed to check for overlapping pages:', err);
        if (!cancelled) setOverlapRead({ key, overlap: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, startSource, siteType, overlapAttempt]);

  const reset = () => {
    setMethod('create');
    setKind('opportunity');
    setPicked(null);
    setFrom('url');
    setPageUrl('');
    setUrlError(null);
    setPastedText('');
    setContent(null);
    setStart(null);
    setOpening(false);
    setOverlapRead(null);
    setWho('me');
  };
  const changeOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const items: PickerItem[] = !options
    ? []
    : kind === 'opportunity'
      ? options.opportunities.map((o) => ({
          value: o.id,
          label: o.title,
          pageTitle: o.pageTitle ?? undefined,
        }))
      : kind === 'prompt'
        ? options.prompts.map((p) => ({ value: p.id, label: p.text }))
        : options.topics.map((topic) => ({
            value: topic.id,
            label: topic.name,
            meta: t('topicPrompts', { count: topic.promptCount }),
          }));

  const bring = (
    html: string,
    imagesRemoved: number,
    origin: { fileName?: string; sourceUrl?: string; title?: string } = {},
  ) => {
    const fallback = origin.title || (origin.fileName ? fileTitle(origin.fileName) : '');
    const summary = summarizeContent(html, fallback);
    if (!summary.characters) {
      toast.error(t('content.empty'));
      return;
    }
    setContent({ ...summary, html, imagesRemoved, ...origin });
  };

  /** A page of the brand's, read by its URL and cleaned like a paste. */
  const readPage = async () => {
    const address = pageUrl.trim();
    if (!address) return;
    setReading(true);
    setUrlError(null);
    try {
      const read = await importContentPage(brandId, address);
      if ('error' in read) {
        setUrlError({ code: read.error, status: read.status });
        return;
      }
      const cleaned = cleanHtml(read.page.html, { keepImages: true });
      bring(cleaned.html, cleaned.imagesRemoved, {
        sourceUrl: read.page.url,
        title: read.page.title,
      });
    } finally {
      setReading(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    // Plain text goes into the box as typed text would; formatted text is
    // cleaned like a paste in the editor and shown as what it holds.
    if (!html) return;
    e.preventDefault();
    const cleaned = cleanHtml(html, { keepImages: false });
    bring(cleaned.html, cleaned.imagesRemoved);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('content.tooLarge', { name: file.name }));
      return;
    }
    setReading(true);
    try {
      const doc = await readDocumentFile(file);
      if (!doc) toast.error(t('content.unsupported', { name: file.name }));
      else bring(doc.html, doc.imagesRemoved, { fileName: file.name });
    } catch (err) {
      console.error('Failed to read a file for New content:', err);
      toast.error(t('content.readFailed', { name: file.name }));
    } finally {
      setReading(false);
    }
  };

  const typed = pastedText.trim();
  const canContinue =
    method === 'create' ? picked !== null : content !== null || (from === 'paste' && !!typed);

  const toStart = () => {
    if (method === 'create') {
      if (!picked) return;
      const title = picked.pageTitle ?? picked.label;
      const type = startPageType({ title }, siteType);
      const newPageType = {
        pageType: type.pageType,
        detectedFrom: type.detected ? ('title' as const) : null,
        picked: false,
      };
      setStart({
        method,
        title,
        source: { kind, id: picked.value },
        ...newPageType,
        newPageType,
        choice: { kind: 'create' },
      });
      return;
    }
    const brought =
      content ??
      (typed ? { ...summarizeContent(textToHtml(typed)), html: textToHtml(typed) } : null);
    if (!brought) return;
    const sourceUrl = 'sourceUrl' in brought ? brought.sourceUrl : undefined;
    const type = startPageType(
      { title: brought.title, html: brought.html, url: sourceUrl },
      siteType,
    );
    const newPageType = {
      pageType: type.pageType,
      detectedFrom: type.detected ? (sourceUrl ? ('page' as const) : ('content' as const)) : null,
      picked: false,
    };
    setStart({
      method,
      title: brought.title,
      source: { kind: 'content' },
      bodyHtml: brought.html,
      sourceUrl,
      ...newPageType,
      newPageType,
      choice: { kind: 'create' },
    });
  };

  // Optimizing an existing page instead: the draft is that page's.
  const existing = start?.choice.kind === 'optimize' ? start.choice.page : null;
  const startMethod: DraftMethod = existing ? 'optimize' : (start?.method ?? 'create');
  const startTitle = existing ? existing.title || pagePath(existing.url) : (start?.title ?? '');

  const openEditor = async () => {
    if (!start) return;
    setOpening(true);
    try {
      // An existing page Start chose to optimize brings its live text; if it
      // can't be read, the draft starts with its title, and says so.
      let bodyHtml = start.bodyHtml;
      if (existing) {
        const read = await importContentPage(brandId, existing.url);
        if ('page' in read) bodyHtml = cleanHtml(read.page.html, { keepImages: true }).html;
        else {
          bodyHtml = undefined;
          toast.warning(t('start.pageUnread', { page: pagePath(existing.url) }));
        }
      }
      const id = await createContentDraft(brandId, {
        method: startMethod,
        title: startTitle,
        pageType: start.pageType,
        typePicked: start.picked,
        source: start.source,
        bodyHtml,
        sourceUrl: existing?.url ?? start.sourceUrl,
      });
      if (who === 'team') {
        await sendToTeam(id);
        return;
      }
      router.push(contentEditorPath(id));
    } catch (err) {
      console.error('Failed to start a draft:', err);
      toast.error(t('start.failed'));
      setOpening(false);
    }
  };

  /**
   * Team: the draft goes to the Action Center as an action for someone to
   * write; it stays in the Library either way.
   */
  const sendToTeam = async (id: string) => {
    const sent = await sendContentDraftToActionCenter(brandId, id);
    changeOpen(false);
    onSent?.();
    if ('error' in sent) {
      toast.error(t('start.sendFailed'), {
        description: sent.error,
        action: { label: t('start.openDraft'), onClick: () => router.push(contentEditorPath(id)) },
      });
      return;
    }
    toast.success(t('start.sent'), {
      description: t('start.sentDescription', { number: sent.actionNo }),
      duration: 10_000,
      action: {
        label: t('start.openAction'),
        onClick: () => router.push(`/dashboard/action-center/actions?action=${sent.actionId}`),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl">
        {start ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8" title={startTitle}>
                {t(startMethod === 'create' ? 'start.titleCreate' : 'start.titleOptimize', {
                  title: startTitle || t('start.untitled'),
                })}
              </DialogTitle>
              <DialogDescription>{t('start.description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label id="start-page-type">{t('start.pageType')}</Label>
              <div
                role="radiogroup"
                aria-labelledby="start-page-type"
                className="flex flex-wrap gap-1.5"
              >
                {SITE_PAGE_TYPES[siteType].map((type) => (
                  <ChoiceChip
                    key={type}
                    selected={start.pageType === type}
                    onSelect={() =>
                      setStart({
                        ...start,
                        pageType: type,
                        detectedFrom: null,
                        picked: true,
                        ...(start.choice.kind === 'create' && {
                          newPageType: { pageType: type, detectedFrom: null, picked: true },
                        }),
                      })
                    }
                  >
                    {tTypes(type)}
                  </ChoiceChip>
                ))}
              </div>
              {start.detectedFrom && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    {
                      title: 'start.detectedTitle',
                      content: 'start.detectedContent',
                      page: 'start.detectedPage',
                    }[start.detectedFrom],
                  )}
                </p>
              )}
            </div>
            {overlapKey && (
              <OverlapCheck
                read={overlapRead?.key === overlapKey ? overlapRead : null}
                choice={start.choice}
                onChoose={(choice) => setStart(withChoice(start, choice, siteType))}
                onRetry={() => {
                  setOverlapRead(null);
                  setOverlapAttempt((n) => n + 1);
                }}
              />
            )}
            <div className="space-y-2">
              <Label id="start-who">{t('who.label')}</Label>
              <div
                role="radiogroup"
                aria-labelledby="start-who"
                className="grid grid-cols-3 gap-1.5"
              >
                {WHO.map((value) => {
                  // The Content Agent comes in its own update (CE-018/022).
                  const soon = value === 'agent';
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={who === value}
                      aria-disabled={soon || undefined}
                      disabled={soon}
                      title={soon ? t('who.agent.soon') : undefined}
                      onClick={() => setWho(value)}
                      className={cn(
                        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                        who === value && 'border-foreground ring-1 ring-inset ring-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/50',
                          who === value && 'border-[5px] border-foreground',
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(`who.${value}.title`)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {soon ? t('who.agent.soon') : t(`who.${value}.hint`)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStart(null)} disabled={opening}>
                <ArrowLeft className="h-4 w-4" />
                {t('back')}
              </Button>
              <Button onClick={() => void openEditor()} disabled={opening}>
                {opening && <Loader2 className="h-4 w-4 animate-spin" />}
                {t(who === 'team' ? 'start.sendToTeam' : 'start.openEditor')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div role="radiogroup" aria-label={t('methodLabel')} className="grid grid-cols-2 gap-2">
              {(['create', 'optimize'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                    method === value && 'border-foreground ring-1 ring-inset ring-foreground',
                  )}
                >
                  <span className="block text-sm font-medium">{t(`methods.${value}.title`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`methods.${value}.hint`)}
                  </span>
                </button>
              ))}
            </div>

            {method === 'create' ? (
              <div className="space-y-2">
                <Label>{t('startFrom')}</Label>
                <Tabs
                  value={kind}
                  onValueChange={(value) => {
                    setKind(value as SourceKind);
                    setPicked(null);
                  }}
                >
                  <TabsList>
                    {SOURCE_KINDS.map((value) => (
                      <TabsTrigger key={value} value={value}>
                        {t(`sources.${value}.tab`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {optionsFailed ? (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    {t('loadError')}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setAttempt((n) => n + 1)}
                    >
                      {t('retry')}
                    </button>
                  </div>
                ) : (
                  <Combobox
                    items={items}
                    value={picked}
                    onValueChange={(item: PickerItem | null) => setPicked(item)}
                    disabled={!options}
                  >
                    <ComboboxTrigger
                      className="w-full"
                      aria-label={t(`sources.${kind}.placeholder`)}
                      title={picked?.label}
                    >
                      {options ? (
                        <ComboboxValue placeholder={t(`sources.${kind}.placeholder`)} />
                      ) : (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t('loading')}
                        </span>
                      )}
                    </ComboboxTrigger>
                    <ComboboxContent>
                      <ComboboxInput placeholder={t(`sources.${kind}.search`)} />
                      <ComboboxList>
                        <ComboboxEmpty>{t(`sources.${kind}.empty`)}</ComboboxEmpty>
                        <ComboboxCollection>
                          {(item: PickerItem) => (
                            <ComboboxItem key={item.value} value={item} title={item.label}>
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {item.meta && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {item.meta}
                                </span>
                              )}
                            </ComboboxItem>
                          )}
                        </ComboboxCollection>
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t('content.label')}</Label>
                <Tabs
                  value={from}
                  onValueChange={(value) => {
                    setFrom(value as ContentFrom);
                    setUrlError(null);
                    setContent(null);
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="url">{t('content.url')}</TabsTrigger>
                    <TabsTrigger value="paste">{t('content.paste')}</TabsTrigger>
                    <TabsTrigger value="file">{t('content.file')}</TabsTrigger>
                  </TabsList>
                </Tabs>
                {content ? (
                  <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={content.title}>
                        {content.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          content.fileName ?? (content.sourceUrl && pagePath(content.sourceUrl)),
                          t('content.summary', {
                            headings: content.headings,
                            characters: formatNumber(content.characters),
                          }),
                          content.imagesRemoved
                            ? t('content.imagesLeftOut', { count: content.imagesRemoved })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('content.clear')}
                      title={t('content.clear')}
                      onClick={() => {
                        setContent(null);
                        setPastedText('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : from === 'url' ? (
                  <div className="space-y-1.5">
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void readPage();
                      }}
                    >
                      <Input
                        value={pageUrl}
                        onChange={(e) => {
                          setPageUrl(e.target.value);
                          setUrlError(null);
                        }}
                        placeholder={t('content.urlPlaceholder')}
                        aria-label={t('content.url')}
                        aria-invalid={urlError !== null}
                        inputMode="url"
                        autoComplete="off"
                        disabled={reading}
                      />
                      <Button type="submit" variant="outline" disabled={reading || !pageUrl.trim()}>
                        {reading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t(reading ? 'content.importing' : 'content.import')}
                      </Button>
                    </form>
                    {urlError ? (
                      <p className="text-xs text-destructive" role="alert">
                        {urlError.code === 'http_error' && urlError.status
                          ? t('content.urlErrors.http_status', { status: urlError.status })
                          : t(`content.urlErrors.${urlError.code}`)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('content.urlHint')}</p>
                    )}
                  </div>
                ) : from === 'paste' ? (
                  <Textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    onPaste={onPaste}
                    rows={5}
                    aria-label={t('content.paste')}
                    placeholder={t('content.pastePlaceholder')}
                  />
                ) : (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={DOCUMENT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        void readFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void readFile(e.dataTransfer.files[0]);
                      }}
                      disabled={reading}
                      className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-sm transition-colors hover:bg-muted/50"
                    >
                      {reading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="font-medium">{t('content.choose')}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{t('content.fileHint')}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => changeOpen(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={toStart} disabled={!canContinue}>
                {t('continue')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function sourceKey(source: Exclude<DraftSource, { kind: 'content' }>) {
  return `${source.kind}:${source.id}`;
}

/** Start with this overlap pick: an existing page brings its own title and type. */
function withChoice(start: StartChoice, choice: OverlapChoice, siteType: SiteType): StartChoice {
  if (choice.kind === 'create') return { ...start, choice, ...start.newPageType };
  const detected = detectPageType({ url: choice.page.url, title: choice.page.title }, siteType);
  return {
    ...start,
    choice,
    pageType: detected ?? start.pageType,
    detectedFrom: detected ? 'page' : null,
    picked: detected ? false : start.picked,
  };
}

/**
 * Start's overlap check (CE-015): the brand's pages AI already cites for these
 * prompts, and what to do about them, the recommended option first.
 */
function OverlapCheck({
  read,
  choice,
  onChoose,
  onRetry,
}: {
  read: OverlapRead | null;
  choice: OverlapChoice;
  onChoose: (choice: OverlapChoice) => void;
  onRetry: () => void;
}) {
  const t = useTranslations('contentEditor.newContent.overlap');
  const overlap = read?.overlap ?? null;
  const advice = overlap ? adviseOverlap(overlap) : null;
  const shown = overlap?.pages.slice(0, 3) ?? [];
  const top = overlap?.pages[0];
  const isChosen = (option: OverlapOption) =>
    option.choice.kind === choice.kind &&
    (option.choice.kind === 'create' ||
      (choice.kind === 'optimize' && option.choice.page.url === choice.page.url));

  const optionText = (option: OverlapOption) => {
    const page = top ? pagePath(top.url) : '';
    switch (option.key) {
      case 'optimizeInstead':
        return {
          title: t('options.optimizeInstead.title', { page }),
          reason: t(
            top?.gscPosition != null
              ? 'options.optimizeInstead.reasonRanked'
              : 'options.optimizeInstead.reason',
            {
              count: top?.promptsInCommon ?? 0,
              total: overlap?.totalPrompts ?? 0,
              citations: formatNumber(top?.citations ?? 0),
              position: Math.round(top?.gscPosition ?? 0),
            },
          ),
        };
      case 'createAnyway':
        return {
          title: t('options.createAnyway.title'),
          reason: t('options.createAnyway.reason'),
        };
      case 'createLinked':
        return {
          title:
            (overlap?.pages.length ?? 0) > 1
              ? t('options.createLinked.titleMany')
              : t('options.createLinked.title', { page }),
          reason: t('options.createLinked.reason'),
        };
      case 'addSection':
        return {
          title: t('options.addSection.title', { page }),
          reason: t('options.addSection.reason'),
        };
    }
  };

  return (
    <div className="space-y-2">
      <Label>{t('label')}</Label>
      {!read ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('checking')}
        </p>
      ) : read.failed || !advice || !overlap ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('failed')}
          <button type="button" className="font-medium underline" onClick={onRetry}>
            {t('retry')}
          </button>
        </p>
      ) : advice.verdict === 'none' ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <span>{overlap.totalPrompts ? t('none') : t('noPrompts')}</span>
          {overlap.totalPrompts > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {t('safe')}
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {advice.verdict === 'covered'
                ? t('covered')
                : t('partial', { count: overlap.pages.length })}
            </p>
            <table className="mt-2 w-full table-fixed text-xs">
              <thead className="text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
                <tr>
                  <th className="py-1 text-left font-medium">{t('columns.page')}</th>
                  <th className="w-28 py-1 pl-3 text-right font-medium">{t('columns.prompts')}</th>
                  <th className="w-28 py-1 pl-3 text-right font-medium">
                    {t('columns.citations')}
                  </th>
                  <th className="w-24 py-1 pl-3 text-right font-medium">{t('columns.google')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((page) => (
                  <tr key={page.url} className="border-t border-amber-500/20">
                    <td className="truncate py-1.5 pr-2" title={page.url}>
                      {pagePath(page.url)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {t('promptsValue', {
                        count: page.promptsInCommon,
                        total: overlap.totalPrompts,
                      })}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {formatNumber(page.citations)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {page.gscPosition == null ? '—' : `#${Math.round(page.gscPosition)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div role="radiogroup" aria-label={t('label')} className="grid gap-1.5">
            {advice.options.map((option) => {
              const text = optionText(option);
              const chosen = isChosen(option);
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => onChoose(option.choice)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                    chosen && 'border-foreground ring-1 ring-inset ring-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/50',
                      chosen && 'border-[5px] border-foreground',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {text.title}
                      {option.recommended && (
                        <span className="rounded-md bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground">
                          {t('recommended')}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">{text.reason}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ChoiceChip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'rounded-lg border px-2.5 py-1 text-sm transition-colors hover:bg-muted/50',
        selected && 'border-foreground font-medium ring-1 ring-inset ring-foreground',
      )}
    >
      {children}
    </button>
  );
}
