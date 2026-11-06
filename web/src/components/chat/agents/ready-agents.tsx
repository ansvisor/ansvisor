'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Lock } from 'lucide-react';
import { AgentAvatar } from '@/components/agentic/agent-avatar';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';
import { presetTriggerDraft, triggerInputOf } from '@/lib/chat/agent-form';
import {
  AGENT_PRESETS,
  filterPresets,
  presetAnchor,
  presetFilterOptions,
  presetFit,
  type AgentPreset,
  type PresetFilter,
  type PresetFit,
  type PresetLock,
} from '@/lib/chat/agents/catalog';
import { siteTypeOf } from '@/lib/content/page-types';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { FormulaChips } from './agent-parts';
import type { AgentWords } from './agent-words';

/**
 * Agent Center › Ready to use (AGENTS plan §1, §3; CHAT-21 §D item 15): the
 * ready-to-use agents as cards in the Agents list's style, ready ones
 * first. Each says what it does, its skills, triggers and mode, and the
 * plan its mode needs where the workspace's plan keeps it closed. **Use
 * this agent** opens New agent filled with it; nothing is saved or turned
 * on until the person does it there. A Soon card says what it waits for and
 * opens nothing. Analysts and Agency partners see the cards with the line
 * the list gives them. Filters: one row of headers (Goal ▾ · Business type ▾
 * · Role ▾), the goal, and business type, industry and role once a preset
 * carries one; each opens its options right under it, one at a time, and
 * names its pick ("Goal: Content ▾"). The agents made for the site type of the
 * brand on screen, or for one of the person's work areas, come first in
 * their group, marked For your site type or For your role. A link from
 * Chat to one card (setup's recommendations, list_ready_agents) brings it
 * into view, marked, once the brands are in: the site type may move it.
 */

const FILTER_KEYS: Record<PresetFilter, string> = {
  goal: 'goals',
  businessType: 'businessTypes',
  industry: 'industries',
  role: 'roles',
};

const LIST_FORMAT = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/**
 * A filter's header (the list's `.fc` chip with a ▾): its options open right
 * under it, and picking one, All too, closes them. It names the pick, so the
 * row says what is filtered.
 */
function FilterMenu({
  filter,
  values,
  picked,
  open,
  onOpenChange,
  onPick,
}: {
  filter: PresetFilter;
  values: readonly string[];
  picked: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (value: string | null) => void;
}) {
  const t = useTranslations('chatAgents.ready');
  const name = t(`filters.${filter}`);
  const label = (value: string) => t(`${FILTER_KEYS[filter]}.${value}`);
  const item = (value: string, text: string) => (
    <DropdownMenuRadioItem
      key={value}
      value={value}
      closeOnClick
      data-slot="ready-filter-option"
      data-filter={filter}
      data-value={value}
    >
      {text}
    </DropdownMenuRadioItem>
  );

  return (
    // Not modal: with one panel open, a click on another header opens that one.
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-action="agents.readyFilter"
        data-filter={filter}
        data-picked={picked ?? undefined}
        className={cn(
          'inline-flex h-7 max-w-full items-center gap-1 rounded-full border bg-card pr-2 pl-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:bg-accent',
          picked &&
            'border-foreground bg-foreground text-background hover:bg-foreground/90 data-popup-open:bg-foreground/90',
        )}
      >
        <span className="truncate">
          {picked ? t('filterPicked', { filter: name, value: label(picked) }) : name}
        </span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={name} className="w-56">
        <DropdownMenuRadioGroup
          value={picked ?? ''}
          onValueChange={(value: string) => onPick(value || null)}
        >
          {item('', t('all'))}
          {values.map((value) => item(value, label(value)))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PresetCard({
  preset,
  lock,
  fit,
  writer,
  words,
}: {
  preset: AgentPreset;
  lock: PresetLock | undefined;
  fit: PresetFit | null;
  writer: boolean;
  words: AgentWords;
}) {
  const t = useTranslations('chatAgents.ready');
  const tAgents = useTranslations('chatAgents');
  const name = tAgents(`presets.${preset.id}.name`);
  const ready = preset.status === 'ready';
  // Its triggers in the list's words; their clock doesn't show, so any zone reads the same.
  const triggers = preset.triggers
    .map((trigger, i) => triggerInputOf(presetTriggerDraft(trigger, `k${i}`, 'UTC')))
    .filter((input) => input !== null)
    .map((input) => words.trigger(input));
  const triggerLine = triggers.length > 0 ? triggers.join(' · ') : tAgents('trigger.manualOnly');
  const needs = LIST_FORMAT.format(preset.needs.map((need) => t(`needs.${need}`)));

  return (
    <article
      id={presetAnchor(preset.id)}
      data-slot="preset-card"
      data-preset={preset.id}
      data-status={preset.status}
      data-fit={fit ?? undefined}
      aria-label={name}
      className={cn(
        'flex min-w-0 flex-col gap-[9px] rounded-[14px] border bg-card p-3.5 shadow-[0_1px_2px_rgba(10,10,10,.04)] target:border-foreground/40',
        ready &&
          'transition-[box-shadow,border-color] duration-200 hover:border-foreground/20 hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] motion-reduce:transition-none',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar tone="muted" decorative />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={name}>
          {name}
        </h3>
        {fit && (
          <span
            data-slot="preset-fit"
            className="shrink-0 rounded-full bg-green-100 px-2 py-px text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            {t(`fit.${fit}`)}
          </span>
        )}
      </div>

      <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
        {tAgents(`presets.${preset.id}.description`)}
      </p>

      {/* On a card, a long formula wraps rather than cutting the mode off. */}
      <FormulaChips
        agent={{ skills: preset.skills, mode: preset.mode }}
        words={words}
        className="flex-wrap"
      />
      {ready && lock && (
        <span
          data-slot="preset-lock"
          title={t('fallbackTip')}
          className="inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-muted px-2 py-px text-[11px] text-foreground/70"
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {lock.kind === 'plan'
              ? tAgents('form.mode.lockTag', { plan: lock.plan, current: lock.current })
              : t('policyLock')}
          </span>
        </span>
      )}

      {(ready || triggers.length > 0) && (
        <div data-cell="trigger" className="min-w-0 text-xs text-muted-foreground">
          {tAgents('list.cells.trigger')}
          <b className="block truncate font-medium text-foreground" title={triggerLine}>
            {triggerLine}
          </b>
        </div>
      )}

      <div className="mt-auto flex min-w-0 items-center gap-1.5 border-t pt-2.5">
        {!ready ? (
          <span data-slot="preset-soon" className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium text-foreground/70">
              {t('soon')}
            </span>
            <span
              className="truncate text-muted-foreground"
              title={t('needsLine', { what: needs })}
            >
              {t('needsLine', { what: needs })}
            </span>
          </span>
        ) : writer ? (
          <Link
            href={`/dashboard/agents/new?preset=${preset.id}`}
            data-action="agents.usePreset"
            aria-label={t('useLabel', { name })}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('use')}
          </Link>
        ) : (
          <span
            data-slot="preset-read-only"
            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Lock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tAgents('list.readOnly.detail')}</span>
          </span>
        )}
      </div>
    </article>
  );
}

export function ReadyAgents({
  locks,
  writer,
  words,
  workAreas = [],
  presets = AGENT_PRESETS,
}: {
  locks: Record<string, PresetLock>;
  /** Admins and Managers: they make agents. */
  writer: boolean;
  words: AgentWords;
  /** The person's work areas (Settings › Menu access). */
  workAreas?: readonly string[];
  /** The catalog; a test's own list otherwise. */
  presets?: readonly AgentPreset[];
}) {
  const options = useMemo(() => presetFilterOptions(presets), [presets]);
  const [picked, setPicked] = useState<Partial<Record<PresetFilter, string | null>>>({});
  // The one filter whose options are open.
  const [openFilter, setOpenFilter] = useState<PresetFilter | null>(null);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const brandsLoaded = useBrandStore((s) => s.loaded);
  // The brand on screen's site type, guessed while it isn't set; none before the brands load.
  const viewer = { siteType: activeBrand ? siteTypeOf(activeBrand) : null, workAreas };
  const shown = filterPresets(presets, picked, viewer);
  const pick = (filter: PresetFilter, value: string | null) =>
    setPicked((was) => ({ ...was, [filter]: value }));

  // A card the address names (#preset-…), in view once the brands set the order.
  useEffect(() => {
    if (!brandsLoaded) return;
    const id = window.location.hash.slice(1);
    if (id.startsWith(presetAnchor(''))) {
      document.getElementById(id)?.scrollIntoView?.({ block: 'center' });
    }
  }, [brandsLoaded]);

  return (
    <div>
      <div data-slot="ready-filters" className="my-3 flex flex-wrap items-center gap-1.5">
        {options.map(({ filter, values }) => (
          <FilterMenu
            key={filter}
            filter={filter}
            values={values}
            picked={picked[filter] ?? null}
            open={openFilter === filter}
            onOpenChange={(open) =>
              // Another header's opening and this one's closing can come in either order.
              setOpenFilter((was) => (open ? filter : was === filter ? null : was))
            }
            onPick={(value) => pick(filter, value)}
          />
        ))}
      </div>

      <div
        data-slot="presets-grid"
        className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3"
      >
        {shown.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            lock={locks[preset.id]}
            fit={presetFit(preset, viewer)}
            writer={writer}
            words={words}
          />
        ))}
      </div>
    </div>
  );
}
