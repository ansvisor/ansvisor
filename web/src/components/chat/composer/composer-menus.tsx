'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatReference, ChatReferenceType } from '@/lib/chat/references';
import { cn } from '@/lib/utils';

/**
 * The composer's menus (CHAT-02 items 11–17, agentic update; mockup #slash,
 * #atmenu, #plusmenu): each opens above the box. Which row is active, and
 * what a pick does, is the composer's; these draw them.
 */

/**
 * The / menu's shortcuts in Wave 1 (CHAT-02 item 12): each fills its
 * starter text. Skills join them when they come (W2-04).
 */
export const SHORTCUTS = [
  { key: 'analyze', command: '/analyze' },
  { key: 'report', command: '/report' },
  { key: 'create', command: '/create' },
] as const;
export type Shortcut = (typeof SHORTCUTS)[number];

/** The shortcuts a "/…" filters to: those whose command or a word of whose name starts with it. */
export function matchShortcuts(query: string, name: (shortcut: Shortcut) => string): Shortcut[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SHORTCUTS];
  return SHORTCUTS.filter(
    (s) =>
      s.command.slice(1).startsWith(q) ||
      name(s)
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
  );
}

/** Each reference type's mark, as the mockup draws it. */
const REFERENCE_MARK: Record<ChatReferenceType, string> = {
  chart: '▤',
  metric: '◔',
  table: '▦',
  prompt: '❝',
  page: '⌁',
  task: '◎',
};

function Panel({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label={label}
      className={cn(
        'absolute bottom-full left-0 z-30 mb-2 max-h-[300px] min-w-[240px] overflow-auto rounded-[14px] border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(10,10,10,.12)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

const row =
  'flex w-full items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[13px] hover:bg-muted aria-selected:bg-muted';

export function SlashMenu({
  shortcuts,
  active,
  onPick,
}: {
  shortcuts: Shortcut[];
  active: number;
  onPick: (shortcut: Shortcut) => void;
}) {
  const t = useTranslations('chatComposer.slash');
  return (
    <Panel label={t('label')} className="w-[min(520px,calc(100vw-2rem))]">
      <div className="flex px-2 py-1.5 text-xs font-semibold">
        {t('title')}
        <span className="ml-auto font-normal text-muted-foreground">{t('keys')}</span>
      </div>
      {shortcuts.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">{t('none')}</p>
      ) : (
        shortcuts.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="option"
            aria-selected={i === active}
            data-action="slashMenu.pickShortcut"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
            className={row}
          >
            <span className="font-mono text-[12.5px]">{s.command}</span>
            <span>{t(`shortcuts.${s.key}.name`)}</span>
          </button>
        ))
      )}
    </Panel>
  );
}

export function ReferenceMenu({
  references,
  loading,
  active,
  onPick,
}: {
  references: ChatReference[];
  loading: boolean;
  active: number;
  onPick: (reference: ChatReference) => void;
}) {
  const t = useTranslations('chatComposer.reference');
  return (
    <Panel label={t('title')} className="w-[260px]">
      <div className="px-2 pt-2 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase">
        {t('title')}
      </div>
      {references.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">
          {loading ? t('loading') : t('none')}
        </p>
      ) : (
        references.map((ref, i) => (
          <button
            key={`${ref.type}:${ref.id}`}
            type="button"
            role="option"
            aria-selected={i === active}
            data-action="refMenu.pick"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(ref)}
            className={row}
          >
            <span aria-hidden className="w-3.5 shrink-0 text-foreground">
              {REFERENCE_MARK[ref.type]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{ref.label}</span>
              <em className="block text-[11.5px] text-muted-foreground not-italic">
                {t(`types.${ref.type}`)}
              </em>
            </span>
          </button>
        ))
      )}
    </Panel>
  );
}

export interface PlusItem {
  key: 'attach' | 'connect';
  mark: string;
  label: string;
  note?: string;
  onPick: () => void;
}

export function PlusMenu({ items, active }: { items: PlusItem[]; active: number }) {
  const t = useTranslations('chatComposer.plus');
  return (
    <Panel label={t('label')} className="w-[240px]">
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === active}
          data-action={item.key === 'attach' ? 'plusMenu.attachFiles' : 'plusMenu.connectTool'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={item.onPick}
          className={row}
        >
          <span aria-hidden className="w-3.5 shrink-0 text-foreground">
            {item.mark}
          </span>
          <span className="min-w-0 flex-1">
            {item.label}
            {item.note && (
              <em className="block text-[11.5px] text-muted-foreground not-italic">{item.note}</em>
            )}
          </span>
        </button>
      ))}
    </Panel>
  );
}
