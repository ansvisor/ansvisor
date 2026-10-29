'use client';

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/use-user-role';
import type { ChatMode } from '@/lib/chat/precedence';
import { cn } from '@/lib/utils';
import { composerKeyAction } from './composer-keys';
import { ModeSwitch } from './mode-switch';

/** Where the composer sits (CHAT-02 variants): Chat home, an open chat's dock, the side panel. */
export type ComposerVariant = 'home' | 'dock' | 'panel';

/** The tallest the box grows before it scrolls (CHAT-02 item 4). */
const MAX_HEIGHT = 240;

/** A chip's longest label; longer ones are cut, the whole one in its tooltip (item 5). */
const CHIP_LABEL = 28;

/**
 * A context chip (CHAT-02 items 5–7): what Chat looks at, as the page names
 * it ("Ansvisor", "Last 30 days"). `key` is the page's own handle for it,
 * never shown; the label is a name, never an ID.
 */
export interface ComposerChip {
  key: string;
  label: string;
}

/** What goes with a sent text: the chips still in the box. */
export interface ComposerSend {
  context: ComposerChip[];
}

/** A chip's label as it shows: cut at CHIP_LABEL characters. */
export const chipLabel = (label: string) =>
  label.length > CHIP_LABEL ? `${label.slice(0, CHIP_LABEL - 1)}…` : label;

/** Where a reader learns what their role can do (B1, Your access). */
const ACCESS_HREF = '/dashboard/chat/capabilities';

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
  placeholder,
  disabled = false,
  tools,
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
  /** The empty box's line; "Ask anything…" by default. */
  placeholder?: string;
  /** No sending at all (the usage cap's state, W1-23). */
  disabled?: boolean;
  /** The toolbar's buttons before the mode: ＋, / and @ as their menus come (W1-12). */
  tools?: ReactNode;
  /** The usage meter in the line under the box (W1-23). */
  usage?: ReactNode;
  /** The model button's words; "Auto · Haiku reads, Sonnet writes" by default. */
  modelLabel?: ReactNode;
  onOpenModel?: () => void;
  className?: string;
}) {
  const t = useTranslations('chatComposer');
  const tRoles = useTranslations('chatAccess.roleNames');
  const { role, canManage } = useUserRole();
  const readOnly = !canManage;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const hasText = text.trim().length > 0;
  // The ghost shows in an empty box, not while a run answers or the box is off.
  const ghostShown = !!ghost && text === '' && !running && !disabled;
  const ghostId = useId();

  /** The ghost as the box's text, to edit or send, the cursor after it. */
  const acceptGhost = () => {
    if (!ghost) return;
    setText(ghost);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // The box grows with its lines, from its rows up to MAX_HEIGHT, then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  async function submit(steer: boolean) {
    const message = text.trim();
    if (!message || sending || disabled) return;
    const handler = steer ? onSteer : onSend;
    if (!handler) return;
    setSending(true);
    setText('');
    try {
      const sent = await handler(message, { context: chips });
      if (sent === false) setText(message);
    } catch {
      setText(message);
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

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          'relative rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-colors focus-within:border-foreground/25',
          disabled && 'bg-muted/40',
        )}
      >
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
            {chips.map((chip) => {
              const shown = chipLabel(chip.label);
              return (
                <span
                  key={chip.key}
                  title={shown === chip.label ? undefined : chip.label}
                  className="inline-flex h-[22px] items-center gap-0.5 rounded-[7px] border bg-muted/60 pr-1 pl-[7px] text-[11.5px] text-foreground/80"
                >
                  {shown}
                  {onRemoveChip && (
                    <button
                      type="button"
                      data-action="composer.removeChip"
                      onClick={() => onRemoveChip(chip.key)}
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
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
          {tools}
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
