'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ChatSkillItem } from '@/lib/chat/composer-setup';
import type { ChatReference, ChatReferenceType } from '@/lib/chat/references';
import { SHORTCUTS, shortcutCommand, type Shortcut } from '@/lib/chat/shortcuts';

/**
 * The composer's menus (CHAT-02 items 11–17, agentic update; mockup #slash,
 * #atmenu, #plusmenu): each is a popover on the box, above it, or below it
 * when there's no room above (menuPlacement). Which row is active, and what a
 * pick does, is the composer's; these draw them.
 */

/**
 * The shortcuts a "/…" filters to (CHAT-02 item 12, CHAT-08; the list is
 * lib/chat/shortcuts.ts): those whose command, a part of it, or a word of
 * whose name starts with it. The enabled skills follow them in their own
 * group (W2-04).
 */
export function matchShortcuts(query: string, name: (shortcut: Shortcut) => string): Shortcut[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SHORTCUTS];
  return SHORTCUTS.filter(
    (s) =>
      s.id.startsWith(q) ||
      s.id.split('-').some((part) => part.startsWith(q)) ||
      name(s)
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
  );
}

/**
 * The skills a "/…" filters to (CHAT-13 item 5): those whose name, a part
 * of it, or a word of whose title starts with it.
 */
export function matchSkills(query: string, skills: readonly ChatSkillItem[]): ChatSkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter(
    (s) =>
      s.name.startsWith(q) ||
      s.name.split('-').some((part) => part.startsWith(q)) ||
      s.title
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

/** The tallest a menu gets (mockup: 300px). */
export const MENU_MAX = 300;
/** The gap between the box and its menu. */
const MENU_GAP = 8;
/** The narrowest a menu gets, unless the window is narrower. */
const MENU_MIN_WIDTH = 240;
/** The room a menu keeps from the window's sides. */
const WINDOW_EDGE = 8;
/** The overflow values that clip what sticks out of a box. */
const CLIPS = /^(auto|scroll|hidden|clip)$/;

/** Where a menu sits: in the window, as `position: fixed` places it. */
export interface MenuPlace {
  /** It opens below the box (Chat Home's box sits high on the page). */
  down: boolean;
  maxHeight: number;
  left: number;
  width: number;
  /** Below the box: its top. Above it: its bottom, from the window's bottom, so it stays on the box as it shrinks. */
  top?: number;
  bottom?: number;
}

/**
 * Where a menu opens, how tall and how wide: above the box when its rows fit
 * there, else below when there's more room below. The room ends at every box
 * that clips the composer (the page's scrolling area, under the header) and
 * at the window. It starts at the box's left edge, as wide as `width` but no
 * wider than the box (a narrow panel's) or the window, and never past the
 * window's right edge. The menu is drawn in the page's body (a portal), so it
 * never widens or scrolls what the box sits in.
 */
export function menuPlacement(box: HTMLElement, panel: HTMLElement, width: number): MenuPlace {
  const rect = box.getBoundingClientRect();
  const windowWidth = document.documentElement.clientWidth || window.innerWidth;
  const windowHeight = document.documentElement.clientHeight || window.innerHeight;
  let top = 0;
  let bottom = windowHeight;
  for (let node = box.parentElement; node; node = node.parentElement) {
    if (!CLIPS.test(getComputedStyle(node).overflowY)) continue;
    const clip = node.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const above = rect.top - top;
  const below = bottom - rect.bottom;
  const need = Math.min(MENU_MAX, panel.scrollHeight) + MENU_GAP;
  const down = above < need && below > above;
  const room = (down ? below : above) - MENU_GAP;
  const maxHeight = Math.max(0, Math.min(MENU_MAX, room));
  const most = Math.max(0, Math.min(width, windowWidth - 2 * WINDOW_EDGE));
  const fit = Math.max(Math.min(most, rect.width || most), Math.min(MENU_MIN_WIDTH, most));
  const left = Math.max(WINDOW_EDGE, Math.min(rect.left, windowWidth - WINDOW_EDGE - fit));
  return down
    ? { down, maxHeight, left, width: fit, top: rect.bottom + MENU_GAP }
    : { down, maxHeight, left, width: fit, bottom: windowHeight - rect.top + MENU_GAP };
}

const samePlace = (a: MenuPlace | null, b: MenuPlace) =>
  !!a &&
  a.down === b.down &&
  a.maxHeight === b.maxHeight &&
  a.left === b.left &&
  a.width === b.width &&
  a.top === b.top &&
  a.bottom === b.bottom;

/** The menus' anchor: the composer's box, which they open above or below. */
export type MenuAnchor = RefObject<HTMLElement | null>;

/**
 * A menu as a popover on the box: in the page's body, `position: fixed`
 * against the box, so opening it moves nothing (owner's report 2026-11-14:
 * drawn inside the box, a menu wider than a narrow panel's box made the
 * panel scroll sideways, and the page jumped). It follows the box as the
 * page scrolls, the window changes size or the box grows. The arrows keep
 * the active row in view by scrolling the menu only.
 */
function Panel({
  label,
  anchor,
  width,
  active,
  children,
}: {
  label: string;
  anchor: MenuAnchor;
  /** The width it asks for; the box and the window can make it narrower. */
  width: number;
  /** The active row's index: kept in view as the arrows move it. */
  active?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  // Its side is picked as it opens, before it paints; it follows the box from then on.
  useLayoutEffect(() => {
    const panel = ref.current;
    const box = anchor.current;
    if (!panel || !box) return;
    const fit = () => {
      const next = menuPlacement(box, panel, width);
      setPlace((was) => (samePlace(was, next) ? was : next));
    };
    fit();
    // The menu's own scroll moves nothing else.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && panel.contains(e.target))) fit();
    };
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', onScroll, true);
    const grows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    grows?.observe(box);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', onScroll, true);
      grows?.disconnect();
    };
  }, [anchor, width]);
  useEffect(() => {
    const panel = ref.current;
    const row = panel?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!panel || !row) return;
    // Never scrollIntoView: it scrolls every box around the menu too, the page with them.
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = bottom - panel.clientHeight;
    }
  }, [active]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      data-slot="composer-menu"
      data-side={place ? (place.down ? 'below' : 'above') : undefined}
      style={
        place
          ? {
              left: place.left,
              width: place.width,
              maxHeight: place.maxHeight,
              ...(place.down ? { top: place.top } : { bottom: place.bottom }),
            }
          : // Measured before it paints, out of sight.
            { left: 0, top: 0, width, visibility: 'hidden' }
      }
      className="fixed z-50 overflow-auto rounded-[14px] border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(10,10,10,.12)]"
    >
      {children}
    </div>,
    document.body,
  );
}

const row =
  'flex w-full items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[13px] hover:bg-muted aria-selected:bg-muted';

/**
 * The / menu: the shortcuts, then the Skills group of the enabled skills
 * that match (CHAT-13 item 5), one list for the arrows. "Browse all skills"
 * waits for the Skills page (W3).
 */
export function SlashMenu({
  anchor,
  shortcuts,
  skills = [],
  skillsOn = false,
  active,
  onPick,
  onPickSkill,
}: {
  /** The composer's box, the menu's anchor. */
  anchor: MenuAnchor;
  shortcuts: Shortcut[];
  /** The enabled skills the query matches. */
  skills?: ChatSkillItem[];
  /** The person has skills: the empty state names them too. */
  skillsOn?: boolean;
  /** The active row: the shortcuts first, then the skills. */
  active: number;
  onPick: (shortcut: Shortcut) => void;
  onPickSkill?: (skill: ChatSkillItem) => void;
}) {
  const t = useTranslations('chatComposer.slash');
  return (
    <Panel label={t('label')} anchor={anchor} width={520} active={active}>
      <div className="flex px-2 py-1.5 text-xs font-semibold">
        {t('title')}
        <span className="ml-auto font-normal text-muted-foreground">{t('keys')}</span>
      </div>
      {shortcuts.length === 0 && skills.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">
          {skillsOn ? t('noneWithSkills') : t('none')}
        </p>
      ) : (
        <>
          {shortcuts.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              data-action="slashMenu.pickShortcut"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              className={row}
            >
              <span className="font-mono text-[12.5px]">{shortcutCommand(s)}</span>
              <span>{t(`shortcuts.${s.key}.name`)}</span>
            </button>
          ))}
          {skills.length > 0 && (
            <div role="group" aria-label={t('skills')}>
              <div
                aria-hidden
                className="px-2 pt-2 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
              >
                {t('skills')}
              </div>
              {skills.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  role="option"
                  aria-selected={shortcuts.length + i === active}
                  data-action="slashMenu.pickSkill"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPickSkill?.(s)}
                  className={row}
                >
                  <span className="font-mono text-[12.5px]">/{s.name}</span>
                  <span>{s.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function ReferenceMenu({
  anchor,
  references,
  loading,
  active,
  onPick,
}: {
  anchor: MenuAnchor;
  references: ChatReference[];
  loading: boolean;
  active: number;
  onPick: (reference: ChatReference) => void;
}) {
  const t = useTranslations('chatComposer.reference');
  return (
    <Panel label={t('title')} anchor={anchor} width={260} active={active}>
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
  key: 'attach' | 'image' | 'connect';
  mark: string;
  label: string;
  note?: string;
  onPick: () => void;
}

/** Each ＋ item's action name, as the mockup's #plusmenu names it. */
const PLUS_ACTIONS: Record<PlusItem['key'], string> = {
  attach: 'plusMenu.attachFiles',
  image: 'plusMenu.createImage',
  connect: 'plusMenu.connectTool',
};

export function PlusMenu({
  anchor,
  items,
  active,
}: {
  anchor: MenuAnchor;
  items: PlusItem[];
  active: number;
}) {
  const t = useTranslations('chatComposer.plus');
  return (
    <Panel label={t('label')} anchor={anchor} width={240} active={active}>
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === active}
          data-action={PLUS_ACTIONS[item.key]}
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
