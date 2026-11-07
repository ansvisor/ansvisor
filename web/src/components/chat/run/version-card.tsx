'use client';

import { lazy, Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Send, Sparkles, Undo2 } from 'lucide-react';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from '@/i18n/navigation';
import { requestAccess } from '@/lib/actions/chat-access-requests';
import type { ChatPageVersion } from '@/lib/chat/events';
import { CONTENT_EDITOR_PATH } from '@/lib/content/drafts';
import { BAND_CLASSES, qualityBand } from '@/lib/content/quality';
import { cn } from '@/lib/utils';

// The Send dialog and its reads load on the click: the card itself never pulls them in.
const VersionSendDialog = lazy(() =>
  import('./version-send').then((module) => ({ default: module.VersionSendDialog })),
);

/** The sections a card shows before Show all. */
const PREVIEWED = 2;

/** "Version 2 · 7 questions · 905 characters": a FAQ by its questions, any other page by its sections. */
export function useVersionLine() {
  const t = useTranslations('chatDeliverable.version');
  return (version: ChatPageVersion) =>
    t('line', {
      n: version.n,
      parts:
        version.counts.questions > 0
          ? t('questions', { count: version.counts.questions })
          : t('sections', { count: version.counts.sections }),
      characters: version.counts.characters,
    });
}

const PILL =
  'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium tabular-nums';

/**
 * A version's Rules and Quality pills (CHAT-25 §6, mockup #e-chat; W4-12b
 * part 2), as the Content Editor's header shows them: "Rules {met}/{total}",
 * green with every rule met and amber with some open, and "Quality {score}"
 * in its band's colours. A pill whose read wasn't made isn't shown.
 */
export function VersionPills({ version }: { version: ChatPageVersion }) {
  const t = useTranslations('chatDeliverable.version');
  const tBands = useTranslations('contentEditor.editor.quality.bands');
  const { rules, quality } = version;
  if (!rules && quality === undefined) return null;
  return (
    <span data-slot="version-pills" className="inline-flex flex-wrap items-center gap-1.5">
      {rules && (
        <span
          data-slot="version-rules"
          aria-label={t('rulesPillLabel', { met: rules.met, total: rules.total })}
          className={cn(
            PILL,
            rules.met === rules.total
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
          )}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {t('rulesPill', { met: rules.met, total: rules.total })}
        </span>
      )}
      {quality !== undefined && (
        <span
          data-slot="version-quality"
          aria-label={t('qualityPillLabel', {
            score: quality,
            band: tBands(qualityBand(quality)),
          })}
          className={cn(PILL, BAND_CLASSES[qualityBand(quality)])}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {t('qualityPill', { score: quality })}
        </span>
      )}
    </span>
  );
}

/**
 * A page's version in chat (CHAT-25 §6, mockup #e-chat; W4-12a), under its
 * card's title: What changed since the version before (sections made
 * shorter, with their characters before → after; new questions or sections;
 * placeholders to fill), the first sections with Show all, and Undo to the
 * version before, which puts History's page back (the editor's History). A
 * version saved to the Library each time, as the note says.
 */
export function VersionDetails({
  version,
  runId,
  n,
}: {
  version: ChatPageVersion;
  /**
   * The run and the card's place among its files: what Undo names (no id
   * reaches the page). 0 for a page Files didn't keep, which has no Undo.
   */
  runId: string;
  n: number;
}) {
  const t = useTranslations('chatDeliverable.version');
  const tReadOnly = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const [all, setAll] = useState(false);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { shortened, added, placeholders } = version.changes;
  const changed = version.n > 1 && (shortened.length > 0 || added.length > 0);
  const shown = all ? version.sections : version.sections.slice(0, PREVIEWED);
  const faq = version.counts.questions > 0;
  const undoable = version.canUndo === true && n > 0;

  async function undo() {
    if (!undoable || busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/runs/${runId}/files/${n}/undo`, { method: 'POST' }).catch(
      () => null,
    );
    setBusy(false);
    if (res?.ok) {
      setUndone(true);
      toast(t('undone', { n: version.n - 1 }));
    } else {
      toast.error(t('undoFailed'));
    }
  }

  return (
    <div data-slot="page-version" data-version={version.n} className="grid gap-2 text-[13px]">
      {(changed || placeholders.length > 0) && (
        <div data-slot="version-changes">
          <p className="text-xs font-semibold">{t('whatChanged')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {version.n > 1 &&
              shortened.map((s) => (
                <li key={`s-${s.heading}`}>
                  {t('shortened', { heading: s.heading, before: s.before, after: s.after })}
                </li>
              ))}
            {version.n > 1 &&
              added.map((heading) => (
                <li key={`a-${heading}`}>
                  {t(heading.endsWith('?') ? 'newQuestion' : 'newSection', { heading })}
                </li>
              ))}
            {placeholders.length > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                {t('placeholders', {
                  count: placeholders.length,
                  list: placeholders.join(', '),
                })}
              </li>
            )}
          </ul>
        </div>
      )}
      {shown.length > 0 && (
        <dl data-slot="version-preview" className="grid gap-1.5">
          {shown.map((section, i) => (
            <div key={`${i}-${section.heading}`}>
              <dt className="font-medium">{section.heading}</dt>
              {section.text && <dd className="text-muted-foreground">{section.text}</dd>}
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {version.sections.length > PREVIEWED && (
          <button
            type="button"
            data-action="version.showAll"
            aria-expanded={all}
            onClick={() => setAll((open) => !open)}
            className="text-xs font-medium underline underline-offset-2"
          >
            {all
              ? t('showLess')
              : t(faq ? 'showAllQuestions' : 'showAllSections', {
                  count: faq ? version.counts.questions : version.counts.sections,
                })}
          </button>
        )}
        {undoable && (
          <button
            type="button"
            data-action="version.undo"
            disabled={busy || undone}
            onClick={guard(() => void undo(), { action: tReadOnly('restoreVersion') })}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <Undo2 className="size-3.5" aria-hidden />
            {undone ? t('undoneShort', { n: version.n - 1 }) : t('undo', { n: version.n - 1 })}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('saved')}</p>
    </div>
  );
}

/** The draft a page's card opens in the editor, from its link: the card carries no id. */
export function draftIdOfHref(href: string | undefined): string | null {
  const prefix = `${CONTENT_EDITOR_PATH}/`;
  if (!href?.startsWith(prefix)) return null;
  const id = href.slice(prefix.length);
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/**
 * Send to CMS on a page's version card (CHAT-25 §6, W4-12b): the Library's
 * Send dialog for this one page (version-send.tsx). Shown to Admins and
 * Managers in their own chat; a read-only workspace gets the plan dialog
 * instead.
 */
export function SendPageButton({ href, className }: { href: string; className: string }) {
  const t = useTranslations('chatDeliverable.version');
  const tReadOnly = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const [open, setOpen] = useState(false);
  const draftId = draftIdOfHref(href);
  if (!draftId) return null;
  return (
    <>
      <button
        type="button"
        data-action="version.sendToCms"
        disabled={open}
        onClick={guard(() => setOpen(true), { action: tReadOnly('sendToCms') })}
        className={className}
      >
        <Send className="size-3.5" aria-hidden />
        {t('sendToCms')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <VersionSendDialog
            draftId={draftId}
            href={href}
            onFailed={() => toast.error(t('sendFailed'))}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

/** The menu's head: "{n} rules open · Quality {score}", or "All rules met · Quality {score}". */
export function useOptimizeHeading() {
  const t = useTranslations('chatDeliverable.version.optimize');
  return (version: ChatPageVersion) =>
    [
      version.rules
        ? version.rules.met < version.rules.total
          ? t('rulesOpen', { count: version.rules.total - version.rules.met })
          : t('allMet')
        : null,
      version.quality !== undefined ? t('quality', { score: version.quality }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
}

/**
 * Optimize ▾ on a page's version card (CHAT-25 §7, mockup #e-chat; W4-12b
 * part 2), headed by the rules still open and Quality. Three equal ways,
 * none Recommended and no cost (owner): Optimize here, no editor, which
 * asks Chat in the person's words (optimize_draft, the editor's Rewrite,
 * the next version card with What changed); Optimize in the editor here,
 * the page opened beside the chat (Open here, W4-15c), where what Chat is
 * asked comes back as suggestions to accept or reject; and Optimize in
 * Content Editor. Only Admins and Managers optimize: anyone else, or a
 * read-only workspace, gets "Ask your Admin" in its place (CHAT-25 §13);
 * the two editors open for them read-only.
 */
export function OptimizeMenu({
  version,
  title,
  href,
  canChange,
  onAsk,
  onOpenHere,
  className,
}: {
  version: ChatPageVersion;
  title: string;
  href: string;
  /** An Admin's or a Manager's own chat. */
  canChange: boolean;
  /** Sends a message in this chat as the person's own. */
  onAsk: (prompt: string) => void;
  /** Opens the page beside this chat (Open here): the editor's address. */
  onOpenHere?: (href: string) => void;
  className: string;
}) {
  const t = useTranslations('chatDeliverable.version.optimize');
  const heading = useOptimizeHeading()(version);
  const router = useRouter();
  const { isLocked } = useUpgradeGate();
  const allowed = canChange && !isLocked;

  async function askAdmin() {
    const sent = await requestAccess({
      asked: t('asked', { title }).slice(0, 500),
      ruleKind: isLocked ? 'plan' : 'role',
      ruleDetail: t('noAccess'),
    }).catch(() => null);
    if (sent?.ok) toast(t('askSent'));
    else toast.error(t('askFailed'));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-action="version.optimize" className={className}>
        <Sparkles className="size-3.5" aria-hidden />
        {t('button')}
        <ChevronDown className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          {heading && (
            <DropdownMenuLabel data-slot="optimize-heading" className="font-normal">
              {heading}
            </DropdownMenuLabel>
          )}
          <DropdownMenuItem
            data-action="version.optimizeHere"
            disabled={!allowed}
            onClick={() => onAsk(t('prompt', { title }))}
            className="flex-col items-start gap-0.5 text-[13px]"
          >
            <span className="font-medium">{t('here')}</span>
            <span className="text-xs text-muted-foreground">
              {allowed ? t('hereDetail', { n: version.n + 1 }) : t('noAccess')}
            </span>
          </DropdownMenuItem>
          {onOpenHere && (
            <DropdownMenuItem
              data-action="version.optimizeInEditorHere"
              onClick={() => onOpenHere(href)}
              className="flex-col items-start gap-0.5 text-[13px]"
            >
              <span className="font-medium">{t('editorHere')}</span>
              <span className="text-xs text-muted-foreground">{t('editorHereDetail')}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            data-action="version.optimizeInEditor"
            onClick={() => router.push(href)}
            className="flex-col items-start gap-0.5 text-[13px]"
          >
            <span className="font-medium">{t('editor')}</span>
            <span className="text-xs text-muted-foreground">{t('editorDetail')}</span>
          </DropdownMenuItem>
          {!allowed && (
            <DropdownMenuItem
              data-action="version.askAdmin"
              onClick={() => void askAdmin()}
              className="text-[13px] font-medium"
            >
              {t('askAdmin')}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
