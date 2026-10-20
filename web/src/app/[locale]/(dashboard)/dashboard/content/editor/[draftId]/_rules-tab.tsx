'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isPageType, type PageType } from '@/lib/content/drafts';
import { SITE_PAGE_TYPES, type SiteType } from '@/lib/content/page-types';
import { RULE_GROUPS, type ActiveRule, type RuleStatus } from '@/lib/content/rules';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DraftRulesState } from './_use-draft-rules';

/** Rules with an explanation on hover (spec §10). */
const HINTED = new Set([
  'summary',
  'fanoutH2',
  'internalLinks',
  'outboundLinks',
  'aiTraces',
  'whoFor',
  'first40Words',
  'feedMatch',
]);

/**
 * The Rules tab (Content Editor CE-009, spec §10): the rule set for the
 * page's type — its own rules, then length and structure, fan-outs and
 * keywords, links and sources, style — each with an on/off switch, a value
 * the person can change for this draft, and its status as the page reads
 * now. "N of M rules met" counts the rules on that the page can say; the
 * header's chip shows the same.
 */
export function RulesTab({
  state,
  siteType,
  draftPageType,
}: {
  state: DraftRulesState;
  siteType: SiteType;
  draftPageType: PageType | null;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const types = [...SITE_PAGE_TYPES[siteType]];
  for (const type of [draftPageType, state.setType]) {
    if (type && !types.includes(type)) types.push(type);
  }
  const items = types.map((type) => ({ value: type, label: t('setName', { type: tTypes(type) }) }));

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">{t('set')}</span>
        <Select
          items={items}
          value={state.setType ?? ''}
          onValueChange={(value) => {
            if (!isPageType(value)) return;
            state.pickSet(value === draftPageType ? null : value);
          }}
        >
          <SelectTrigger aria-label={t('set')} className="w-full">
            <SelectValue placeholder={t('pickSet')} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground" role="status">
          {t('met', { met: state.met, total: state.total })}
        </p>
      </div>

      {RULE_GROUPS.map((group) => {
        const rows = state.rules.filter((r) => r.rule.group === group);
        if (!rows.length) return null;
        return (
          <section key={group} className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              {group === 'type' && state.setType
                ? t('typeGroup', { type: tTypes(state.setType) })
                : t(`groups.${group}`)}
            </h4>
            <ul className="divide-y rounded-lg border">
              {rows.map(({ rule, status }) => (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  status={status}
                  onChange={(change) => state.change(rule.key, change)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-[11px] text-muted-foreground">{t('note')}</p>
    </div>
  );
}

function RuleRow({
  rule,
  status,
  onChange,
}: {
  rule: ActiveRule;
  status: RuleStatus;
  onChange: (change: { on?: boolean; value?: string }) => void;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const name = t(`names.${rule.key}`);
  return (
    <li className={cn('px-3 py-2', !rule.on && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={rule.on}
          aria-label={t('toggle', { name })}
          onClick={() => onChange({ on: !rule.on })}
          className={cn(
            'relative h-4 w-7 shrink-0 rounded-full transition-colors',
            rule.on ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
              rule.on ? 'left-3.5' : 'left-0.5',
            )}
          />
        </button>
        <span
          className="min-w-0 flex-1 text-xs"
          title={HINTED.has(rule.key) ? t(`hints.${rule.key}`) : undefined}
        >
          {name}
        </span>
        <StatusBadge on={rule.on} status={status} />
      </div>
      {rule.kind !== 'switch' && (
        <div className="mt-1 flex items-center gap-1 pl-9">
          <RuleValue rule={rule} name={name} onCommit={(value) => onChange({ value })} />
        </div>
      )}
    </li>
  );
}

/** A rule's value: changed for this draft when the field is left or Enter is pressed. */
function RuleValue({
  rule,
  name,
  onCommit,
}: {
  rule: ActiveRule;
  name: string;
  onCommit: (value: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const [text, setText] = useState(rule.current);
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : rule.current;

  const commit = () => {
    setEditing(false);
    const value = text.trim();
    if (value === rule.current) return;
    if (rule.kind === 'number' && !/^\d{1,6}$/.test(value)) return;
    onCommit(value);
  };

  const wide = rule.kind !== 'number';
  return (
    <span className={cn('flex items-center gap-1', wide ? 'min-w-0 flex-1' : 'shrink-0')}>
      <input
        value={shown}
        inputMode={rule.kind === 'number' ? 'numeric' : undefined}
        aria-label={t('value', { name })}
        placeholder={rule.key === 'whoFor' ? t('whoForPlaceholder') : undefined}
        maxLength={500}
        onFocus={() => {
          setText(rule.current);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(rule.current);
            setEditing(false);
          }
        }}
        className={cn(
          'h-6 rounded-md border bg-background px-1.5 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          wide ? 'min-w-0 flex-1' : 'w-14 text-right',
          rule.changed && 'border-primary/50',
        )}
      />
      {rule.unit && (
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">
          {t(`units.${rule.unit}`)}
        </span>
      )}
    </span>
  );
}

function StatusBadge({ on, status }: { on: boolean; status: RuleStatus }) {
  const t = useTranslations('contentEditor.editor.rules.status');
  if (!on) {
    return (
      <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">{t('off')}</span>
    );
  }
  let text: string;
  if (status.state === 'ok') text = '✓';
  else if (status.code === 'partOf') text = t('partOf', { count: status.count, of: status.of });
  else if (status.code === 'current') text = formatNumber(status.count);
  else if ('count' in status) text = t(status.code, { count: status.count });
  else text = t(status.code);
  return (
    <span
      className={cn(
        'w-20 shrink-0 truncate text-right text-[11px] font-medium',
        status.state === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        status.state === 'bad' && 'text-amber-600 dark:text-amber-400',
        status.state === 'info' && 'font-normal text-muted-foreground',
      )}
      title={text}
    >
      {text}
    </span>
  );
}
