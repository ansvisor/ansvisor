'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowUp } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/use-user-role';
import { requestAccess } from '@/lib/actions/chat-access-requests';
import type { ChatMode } from '@/lib/chat/precedence';
import { MAX_REFERENCES, type ChatReference } from '@/lib/chat/references';
import { cn } from '@/lib/utils';
import { composerKeyAction } from './composer-keys';
import {
  PlusMenu,
  ReferenceMenu,
  SlashMenu,
  matchShortcuts,
  type PlusItem,
  type Shortcut,
} from './composer-menus';
import { ModeSwitch } from './mode-switch';

/** Where the composer sits (CHAT-02 variants): Chat home, an open chat's dock, the side panel. */
export type ComposerVariant = 'home' | 'dock' | 'panel';

/** The tallest the box grows before it scrolls (CHAT-02 item 4). */
const MAX_HEIGHT = 240;

/** A chip's longest label; longer ones are cut, the whole one in its tooltip (item 5). */
const CHIP_LABEL = 28;

/** Where a reader learns what their role can do (B1, Your access). */
const ACCESS_HREF = '/dashboard/chat/capabilities';

/** Where an Admin connects a tool. */
const INTEGRATIONS_HREF = '/dashboard/settings/integrations';

/**
 * A context chip (CHAT-02 items 5–7): what Chat looks at, as the page names
 * it ("Ansvisor", "Last 30 days"). `key` is the page's own handle for it,
 * never shown; the label is a name, never an ID.
 */
export interface ComposerChip {
  key: string;
  label: string;
}

/** What goes with a sent text: the chips still in the box, and the data referenced with @. */
export interface ComposerSend {
  context: ComposerChip[];
  references: ChatReference[];
}

/** A chip's label as it shows: cut at CHIP_LABEL characters. */
export const chipLabel = (label: string) =>
  label.length > CHIP_LABEL ? `${label.slice(0, CHIP_LABEL - 1)}…` : label;

/** An open menu: which, and for / and @ what is typed after it and where it starts. */
type OpenMenu =
  | { kind: 'slash'; query: string; typed: boolean }
  | { kind: 'at'; query: string; start: number }
  | { kind: 'plus' };

/** "@…" right before the cursor, at the start of a word: what is typed after it, and where it starts. */
export function atQuery(text: string, cursor: number): { query: string; start: number } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor));
  return match ? { query: match[2], start: cursor - match[2].length - 1 } : null;
}

const refKey = (ref: ChatReference) => `ref:${ref.type}:${ref.id}`;

/**
 * Chat's composer (CHAT-02, mockup compHTML): the box, its toolbar with the
 * run mode and Send, and the line under it. Enter sends, Shift+Enter adds a
 * line. While a run answers, Send is Stop (Esc too), and the box steers:
 * Enter stops the run, its done steps kept, and sends the text as the next
 * message (decided 2026-10-30). Analysts and Agency partners read only: no
 * mode switch and no skills, a "Read-only" link to what they can do. A send
 * the page refuses (it answers false) puts the text back.
 *
 * Context chips sit above the text (W1-11): × takes one off, and the page
 * keeps it off for the rest of the chat; a send carries the chips left. The
 * empty box can show one ghost suggestion, dim, with a Tab hint: Tab (or a
 * click on it) makes it the text, to edit or send; typing replaces it; it
 * never sends itself, and Enter and Send wait while only it shows.
 *
 * Menus (W1-12): "/" first in an empty box, or the / button, lists the
 * shortcuts that start a message; "@" at the start of a word, or the @
 * button, references data (the page's own first, then the brand's prompts,
 * pages and open tasks), the pick a chip; ＋ attaches files and connects a
 * tool. ↑ ↓ move, Enter picks, Esc closes and keeps the text.
 */
export function ChatComposer({
  variant = 'dock',
  mode,
  onModeChange,
  fullAutoOpen,
  running = false,
  onSend,
  onStop,
  onSteer,
  chips = [],
  onRemoveChip,
  ghost,
  references: pageReferences = [],
  searchReferences,
  onAttach,
  placeholder,
  disabled = false,
  usage,
  modelLabel,
  onOpenModel,
  className,
}: {
  variant?: ComposerVariant;
  /** The mode the next run starts in: the person's default mode until they pick one. */
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  /** Full auto is open to this workspace (plan facts: Growth and up, paid). */
  fullAutoOpen: boolean;
  /** A run answers: Send is Stop, and the box steers. */
  running?: boolean;
  onSend: (text: string, sent: ComposerSend) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  /** Stops the run and sends the text: without it, Enter waits for the run. */
  onSteer?: (text: string, sent: ComposerSend) => boolean | void | Promise<boolean | void>;
  /** What Chat looks at, as chips above the text (the page's context, CHAT-01). */
  chips?: ComposerChip[];
  /** × on a chip: the page drops it for this chat. */
  onRemoveChip?: (key: string) => void;
  /**
   * One suggestion for the empty box: the variant's starter before the first
   * message, then a clear follow-up only (CHAT-07). A READ one for Analysts
   * and Agency partners: the page picks it.
   */
  ghost?: string;
  /** What the page itself can be asked about, first in the @ menu (W1-08). */
  references?: ChatReference[];
  /** The brand's matches for "@…" (searchChatReferences); none without it. */
  searchReferences?: (query: string) => Promise<ChatReference[]>;
  /** Attach files in the ＋ menu (W1-13); not listed without it. */
  onAttach?: () => void;
  /** The empty box's line; "Ask anything…" by default. */
  placeholder?: string;
  /** No sending at all (the usage cap's state, W1-23). */
  disabled?: boolean;
  /** The usage meter in the line under the box (W1-23). */
  usage?: ReactNode;
  /** The model button's words; "Auto · Haiku reads, Sonnet writes" by default. */
  modelLabel?: ReactNode;
  onOpenModel?: () => void;
  className?: string;
}) {
  const t = useTranslations('chatComposer');
  const tRoles = useTranslations('chatAccess.roleNames');
  const tAsk = useTranslations('chatAccess.askAdmin');
  const router = useRouter();
  const { role, canAdmin, canManage } = useUserRole();
  const readOnly = !canManage;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // The data referenced with @, as chips after the page's.
  const [refs, setRefs] = useState<ChatReference[]>([]);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ query: string; refs: ChatReference[] } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const hasText = text.trim().length > 0;
  // The ghost shows in an empty box, not while a run answers or the box is off.
  const ghostShown = !!ghost && text === '' && !running && !disabled;
  const ghostId = useId();

  // The box grows with its lines, from its rows up to MAX_HEIGHT, then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  // A menu closes on a click outside the composer.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  // The brand's matches for what follows "@": the last search answered wins.
  const atSearch = menu?.kind === 'at' ? menu.query : null;
  useEffect(() => {
    if (atSearch === null || !searchReferences) return;
    let stale = false;
    const timer = setTimeout(() => {
      void searchReferences(atSearch)
        .catch(() => [])
        .then((matches) => {
          if (!stale) setFound({ query: atSearch, refs: matches });
        });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [atSearch, searchReferences]);

  const shortcutName = (s: Shortcut) => t(`slash.shortcuts.${s.key}.name`);
  const shortcuts = menu?.kind === 'slash' ? matchShortcuts(menu.query, shortcutName) : [];
  const atRefs = (() => {
    if (menu?.kind !== 'at') return [];
    const q = menu.query.toLowerCase();
    const own = pageReferences.filter((r) => !q || r.label.toLowerCase().includes(q));
    const searched = found && found.query === menu.query ? found.refs : [];
    const picked = new Set(refs.map(refKey));
    const seen = new Set<string>();
    return [...own, ...searched]
      .filter((r) => {
        const key = refKey(r);
        if (picked.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_REFERENCES);
  })();
  const atLoading = menu?.kind === 'at' && !!searchReferences && found?.query !== menu.query;

  const plusItems: PlusItem[] = [
    ...(onAttach
      ? [
          {
            key: 'attach' as const,
            mark: '⤒',
            label: t('plus.attach'),
            onPick: () => {
              setMenu(null);
              onAttach();
            },
          },
        ]
      : []),
    {
      key: 'connect',
      mark: '⛓',
      label: canAdmin ? t('plus.connect') : t('plus.connectAsk'),
      note: t('plus.connectNote'),
      onPick: () => {
        setMenu(null);
        if (canAdmin) router.push(INTEGRATIONS_HREF);
        else void askToConnect();
      },
    },
  ];

  const menuLength =
    menu?.kind === 'slash'
      ? shortcuts.length
      : menu?.kind === 'at'
        ? atRefs.length
        : menu?.kind === 'plus'
          ? plusItems.length
          : 0;

  /** One click asks the workspace's Admins to connect a tool (B2's requests). */
  async function askToConnect() {
    try {
      const result = await requestAccess({ asked: t('plus.connectAsked'), ruleKind: 'role' });
      if (result.ok) toast.success(tAsk('sent'));
      else if (result.reason === 'already_today') toast.info(tAsk('alreadyToday'));
      else toast.error(tAsk('failed'));
    } catch {
      toast.error(tAsk('failed'));
    }
  }

  /** The box's text and where its cursor is, after a change: which menu that opens. */
  function textChanged(next: string, cursor: number) {
    setText(next);
    if (!readOnly && /^\/\S*$/.test(next.slice(0, cursor))) {
      setMenu({ kind: 'slash', query: next.slice(1, cursor), typed: true });
      setActive(0);
      return;
    }
    const at = atQuery(next, cursor);
    if (at) {
      setMenu({ kind: 'at', ...at });
      setActive(0);
      return;
    }
    if (menu && menu.kind !== 'plus') setMenu(null);
  }

  /** The text and the cursor after it, focused. */
  function putText(next: string) {
    setText(next);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  }

  /** The ghost as the box's text, to edit or send, the cursor after it. */
  const acceptGhost = () => {
    if (ghost) putText(ghost);
  };

  function pickShortcut(shortcut: Shortcut) {
    const starter = t(`slash.shortcuts.${shortcut.key}.starter`);
    // Typed "/…" is the shortcut's; from the button, the text stays after the starter.
    const rest = menu?.kind === 'slash' && menu.typed ? '' : text.trim();
    setMenu(null);
    putText(`${starter} ${rest}`);
  }

  function pickReference(ref: ChatReference) {
    if (menu?.kind !== 'at') return;
    // "@…" leaves the text; the pick is a chip.
    const end = menu.start + 1 + menu.query.length;
    const next = `${text.slice(0, menu.start)}${text.slice(end)}`.replace(/ {2,}/g, ' ');
    setRefs((all) => [...all, ref]);
    setMenu(null);
    putText(next.trimStart());
  }

  function pickActive() {
    if (menu?.kind === 'slash' && shortcuts[active]) pickShortcut(shortcuts[active]);
    else if (menu?.kind === 'at' && atRefs[active]) pickReference(atRefs[active]);
    else if (menu?.kind === 'plus' && plusItems[active]) plusItems[active].onPick();
  }

  /** A menu from its button: / and ＋ open, @ goes in at the cursor and opens. */
  function openFromButton(kind: 'slash' | 'at' | 'plus') {
    if (menu?.kind === kind) {
      setMenu(null);
      return;
    }
    setActive(0);
    if (kind === 'at') {
      const el = box.current;
      const cursor = el?.selectionStart ?? text.length;
      const before = text.slice(0, cursor);
      const insert = before === '' || /\s$/.test(before) ? '@' : ' @';
      const next = `${before}${insert}${text.slice(cursor)}`;
      const at = cursor + insert.length;
      setText(next);
      setMenu({ kind: 'at', query: '', start: at - 1 });
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.setSelectionRange(at, at);
      });
      return;
    }
    setMenu(kind === 'slash' ? { kind: 'slash', query: '', typed: false } : { kind: 'plus' });
    box.current?.focus();
  }

  async function submit(steer: boolean) {
    const message = text.trim();
    if (!message || sending || disabled) return;
    const handler = steer ? onSteer : onSend;
    if (!handler) return;
    const sentRefs = refs;
    setSending(true);
    setText('');
    setRefs([]);
    setMenu(null);
    try {
      const sent = await handler(message, { context: chips, references: sentRefs });
      if (sent === false) {
        setText(message);
        setRefs(sentRefs);
      }
    } catch {
      setText(message);
      setRefs(sentRefs);
    } finally {
      setSending(false);
      box.current?.focus();
    }
  }

  const under = running
    ? hasText && onSteer
      ? t('under.steer')
      : t('under.answering')
    : readOnly
      ? t('under.readOnly')
      : ghostShown
        ? t('under.ghostHint')
        : t('under.hint');

  const shownChips: (ComposerChip & { remove?: () => void })[] = [
    ...chips.map((chip) => ({
      ...chip,
      remove: onRemoveChip ? () => onRemoveChip(chip.key) : undefined,
    })),
    ...refs.map((ref) => ({
      key: refKey(ref),
      label: ref.label,
      remove: () => setRefs((all) => all.filter((r) => refKey(r) !== refKey(ref))),
    })),
  ];
  const iconButton =
    'flex size-7 items-center justify-center rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground';

  return (
    <div ref={root} className={cn('w-full', className)}>
      <div
        className={cn(
          'relative rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-colors focus-within:border-foreground/25',
          disabled && 'bg-muted/40',
        )}
      >
        {menu?.kind === 'slash' && (
          <SlashMenu shortcuts={shortcuts} active={active} onPick={pickShortcut} />
        )}
        {menu?.kind === 'at' && (
          <ReferenceMenu
            references={atRefs}
            loading={atLoading}
            active={active}
            onPick={pickReference}
          />
        )}
        {menu?.kind === 'plus' && <PlusMenu items={plusItems} active={active} />}
        {shownChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
            {shownChips.map((chip) => {
              const shown = chipLabel(chip.label);
              return (
                <span
                  key={chip.key}
                  title={shown === chip.label ? undefined : chip.label}
                  className="inline-flex h-[22px] items-center gap-0.5 rounded-[7px] border bg-muted/60 pr-1 pl-[7px] text-[11.5px] text-foreground/80"
                >
                  {shown}
                  {chip.remove && (
                    <button
                      type="button"
                      data-action="composer.removeChip"
                      onClick={() => {
                        chip.remove?.();
                        // The × goes with its chip: keep the focus in the composer.
                        box.current?.focus();
                      }}
                      aria-label={t('removeChip', { label: chip.label })}
                      className="inline-flex size-4 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        <div className="relative">
          <textarea
            ref={box}
            data-action="composer.input"
            value={text}
            rows={variant === 'home' ? 2 : 1}
            disabled={disabled}
            aria-label={t('message')}
            aria-describedby={ghostShown ? ghostId : undefined}
            placeholder={
              ghostShown
                ? undefined
                : running
                  ? t('steerPlaceholder')
                  : (placeholder ?? t('placeholder'))
            }
            onChange={(e) => textChanged(e.target.value, e.target.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (menu) {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMenu(null);
                  return;
                }
                if (menuLength > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  const step = e.key === 'ArrowDown' ? 1 : -1;
                  setActive((i) => (i + step + menuLength) % menuLength);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && menuLength > 0) {
                  e.preventDefault();
                  pickActive();
                  return;
                }
              }
              const action = composerKeyAction({
                key: e.key,
                shiftKey: e.shiftKey,
                composing: e.nativeEvent.isComposing || e.keyCode === 229,
                coarse: window.matchMedia?.('(pointer: coarse)')?.matches ?? false,
                running,
                hasText,
                canSteer: !!onSteer,
                ghost: ghostShown,
              });
              if (!action) return;
              e.preventDefault();
              if (action === 'stop') onStop?.();
              else if (action === 'accept') acceptGhost();
              else if (action === 'send') void submit(false);
              else if (action === 'steer') void submit(true);
            }}
            className="block w-full resize-none bg-transparent px-3 py-2 text-[14.5px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {ghostShown && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex px-3 py-2 text-[14.5px] leading-6">
              <span
                id={ghostId}
                data-action="composer.acceptGhost"
                role="button"
                tabIndex={-1}
                onClick={acceptGhost}
                className="pointer-events-auto flex min-w-0 cursor-pointer items-center text-muted-foreground/70"
              >
                <span className="truncate">{ghost}</span>
                <kbd className="ml-1.5 shrink-0 rounded-[4px] border px-1 font-sans text-[11px] text-muted-foreground">
                  {t('tab')}
                </kbd>
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1.5 pr-2 pb-2 pl-2.5">
          <button
            type="button"
            data-action="composer.openPlus"
            aria-label={t('plus.label')}
            aria-expanded={menu?.kind === 'plus'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openFromButton('plus')}
            className={iconButton}
          >
            ＋
          </button>
          {!readOnly && (
            <button
              type="button"
              data-action="composer.openSlash"
              aria-label={t('slash.label')}
              title={t('slash.label')}
              aria-expanded={menu?.kind === 'slash'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openFromButton('slash')}
              className={iconButton}
            >
              /
            </button>
          )}
          <button
            type="button"
            data-action="composer.openRef"
            aria-label={t('reference.label')}
            title={t('reference.label')}
            aria-expanded={menu?.kind === 'at'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openFromButton('at')}
            className={iconButton}
          >
            @
          </button>
          {readOnly ? (
            <Link
              data-action="access.see"
              href={ACCESS_HREF}
              title={t('readOnlyTitle', { role: tRoles(role) })}
              className="rounded-lg border bg-muted/60 px-[9px] py-[3px] text-xs text-foreground/80 no-underline hover:bg-muted"
            >
              {t('readOnly', { role: tRoles(role) })}
            </Link>
          ) : (
            <ModeSwitch mode={mode} onChange={onModeChange} fullAutoOpen={fullAutoOpen} />
          )}
          {running ? (
            <button
              type="button"
              data-action="composer.stop"
              onClick={onStop}
              aria-label={t('stop')}
              title={t('stop')}
              className="ml-auto flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background"
            >
              <i className="block size-2.5 rounded-[2px] bg-background" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              data-action="composer.send"
              onClick={() => void submit(false)}
              disabled={!hasText || sending || disabled}
              aria-label={t('send')}
              title={t('send')}
              className="ml-auto flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 px-0.5 text-[11.5px] text-muted-foreground">
        <span>{under}</span>
        <span className="ml-auto flex items-center gap-2.5">
          {usage}
          {onOpenModel ? (
            <button
              type="button"
              data-action="model.openMenu"
              onClick={onOpenModel}
              aria-label={t('model')}
              className="rounded-[7px] px-1.5 py-0.5 text-foreground hover:bg-muted"
            >
              {modelLabel ?? <ModelAuto />} ▾
            </button>
          ) : (
            <span className="px-1.5 py-0.5 text-foreground">{modelLabel ?? <ModelAuto />}</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** "Auto · Haiku reads, Sonnet writes", the model button on Auto (agentic update). */
function ModelAuto() {
  const t = useTranslations('chatComposer');
  return (
    <>
      {t('modelAuto')} <em className="text-muted-foreground not-italic">· {t('modelAutoHow')}</em>
    </>
  );
}
