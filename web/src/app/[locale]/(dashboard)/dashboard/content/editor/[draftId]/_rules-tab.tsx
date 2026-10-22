'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isPageType, type PageType } from '@/lib/content/drafts';
import { SITE_PAGE_TYPES, type SiteType } from '@/lib/content/page-types';
import {
  MAX_TEXT_RULE_LENGTH,
  RULE_GROUPS,
  splitRules,
  type ActiveRule,
  type RuleStatus,
  type TextRule,
} from '@/lib/content/rules';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-user-role';
import type { DraftRulesState } from './_use-draft-rules';

/** Rules with an explanation on hover (spec §10). */
const HINTED = new Set([
  'length',
  'oneH1',
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
 * header's chip shows the same. Rules in the person's own words follow
 * ("Your text rules"); Save as my rules keeps the set for the workspace's
 * drafts of the type, and Reset goes back to Ansvisor's default.
 */
/** Apply rules with Agent (CE-018), as the editor runs it. */
export interface AgentFix {
  /** Runs the agent on the open rules, or only on the ones named. */
  run: (only?: string[]) => void;
  running: boolean;
  /** Why it can't run now (suggestions still open), or null. */
  blocked: string | null;
}

export function RulesTab({
  state,
  siteType,
  draftPageType,
  agentFix,
}: {
  state: DraftRulesState;
  siteType: SiteType;
  draftPageType: PageType | null;
  agentFix?: AgentFix;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const tTypes = useTranslations('contentEditor.pageTypes');
  // The workspace's sets are saved by admins and managers, as its other settings are.
  const { canManage } = useUserRole();
  const types = [...SITE_PAGE_TYPES[siteType]];
  for (const type of [draftPageType, state.setType, ...state.mineTypes]) {
    if (type && !types.includes(type)) types.push(type);
  }
  const items = [
    ...types.map((type) => ({
      value: `default:${type}`,
      label: t('setName', { type: tTypes(type) }),
    })),
    ...state.mineTypes.map((type) => ({
      value: `mine:${type}`,
      label: t('mineName', { type: tTypes(type) }),
    })),
  ];

  // A draft on My rules for a type the workspace has none for (its type
  // changed, or My rules couldn't be read) shows Ansvisor's set for it.
  const source =
    state.source === 'mine' && state.setType && state.mineTypes.includes(state.setType)
      ? 'mine'
      : 'default';

  return (
    // Nothing changes before My rules are read: a change would leave them out.
    <fieldset
      disabled={!state.ready}
      aria-busy={!state.ready}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-sm"
    >
      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">{t('set')}</span>
        <Select
          items={items}
          value={state.setType ? `${source}:${state.setType}` : ''}
          onValueChange={(value) => {
            const [source, type] = String(value ?? '').split(':');
            if (!isPageType(type) || (source !== 'default' && source !== 'mine')) return;
            state.pickSet(type, source);
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
        {agentFix && state.met < state.total && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={agentFix.running || agentFix.blocked !== null}
            title={agentFix.blocked ?? t('agentFixHint')}
            onClick={() => agentFix.run()}
          >
            {agentFix.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            {agentFix.running ? t('agentFixing') : t('agentFix')}
          </Button>
        )}
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
                  agentFix={rule.key === 'aiTraces' ? agentFix : undefined}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {state.textRules.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t('text.title')}</h4>
          <ul className="divide-y rounded-lg border">
            {state.textRules.map(({ rule, check }) => (
              <TextRuleRow
                key={rule.id}
                rule={rule}
                check={check}
                onChange={(change) => state.changeTextRule(rule.id, change)}
              />
            ))}
          </ul>
        </section>
      )}

      <AddTextRules onAdd={state.addTextRules} />

      <div className="flex flex-wrap gap-2">
        {canManage && (
          <Button size="sm" disabled={!state.setType} onClick={state.saveAsMine}>
            {t('saveMine')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={state.reset}>
          {t('reset')}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">{t('note')}</p>
    </fieldset>
  );
}

/** A rule in the person's own words: edited in place, turned off, removed when emptied. */
function TextRuleRow({
  rule,
  check,
  onChange,
}: {
  rule: TextRule;
  check: 'numberCheck' | 'aiCheck';
  onChange: (change: { text?: string; on?: boolean }) => void;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const [text, setText] = useState(rule.text);
  const [editing, setEditing] = useState(false);
  const commit = () => {
    setEditing(false);
    if (text.trim() !== rule.text) onChange({ text });
  };
  return (
    <li className={cn('flex items-center gap-2 px-3 py-2', !rule.on && 'opacity-60')}>
      <Switch
        on={rule.on}
        label={t('toggle', { name: rule.text })}
        onToggle={() => onChange({ on: !rule.on })}
      />
      <input
        value={editing ? text : rule.text}
        title={rule.text}
        aria-label={t('text.edit')}
        maxLength={MAX_TEXT_RULE_LENGTH}
        onFocus={() => {
          setText(rule.text);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(rule.text);
            setEditing(false);
          }
        }}
        className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-xs outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <span
        className="w-20 shrink-0 text-right text-[11px] text-muted-foreground"
        title={t(`text.${check}Hint`)}
      >
        {rule.on ? t(`status.${check}`) : t('status.off')}
      </span>
    </li>
  );
}

/** Write a rule, or paste many: each line becomes a rule (bullets and numbering taken off). */
function AddTextRules({ onAdd }: { onAdd: (lines: string[]) => void }) {
  const t = useTranslations('contentEditor.editor.rules.text');
  const [text, setText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const lines = splitRules(text);
  const pastedLines = splitRules(pasted);

  return (
    <div className="space-y-1.5 rounded-lg border p-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('placeholder')}
        aria-label={t('write')}
        rows={2}
        className="min-h-0 resize-none border-0 p-1 text-xs shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && lines.length) {
            e.preventDefault();
            onAdd(lines);
            setText('');
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t('help')}</span>
        <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
          {t('pasteMany')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!lines.length}
          onClick={() => {
            onAdd(lines);
            setText('');
          }}
        >
          {t('add')}
        </Button>
      </div>
      <Dialog open={pasting} onOpenChange={setPasting}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pasteTitle')}</DialogTitle>
            <DialogDescription>{t('pasteDescription')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label={t('pasteTitle')}
            rows={8}
            className="text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasting(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!pastedLines.length}
              onClick={() => {
                onAdd(pastedLines);
                setPasted('');
                setPasting(false);
              }}
            >
              {t('addMany', { count: pastedLines.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuleRow({
  rule,
  status,
  onChange,
  agentFix,
}: {
  rule: ActiveRule;
  status: RuleStatus;
  onChange: (change: { on?: boolean; value?: string }) => void;
  /** "Remove AI traces" offers Fix: the agent rewrites only those phrases. */
  agentFix?: AgentFix;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const name = t(`names.${rule.key}`);
  return (
    <li className={cn('px-3 py-2', !rule.on && 'opacity-60')}>
      <div className="flex items-center gap-2">
        {rule.fixed ? (
          // Always on: the editor keeps it, so it has no switch.
          <span aria-hidden="true" className="w-7 shrink-0" />
        ) : (
          <Switch
            on={rule.on}
            label={t('toggle', { name })}
            onToggle={() => onChange({ on: !rule.on })}
          />
        )}
        <span
          className="min-w-0 flex-1 text-xs"
          title={HINTED.has(rule.key) ? t(`hints.${rule.key}`) : undefined}
        >
          {name}
        </span>
        <StatusBadge on={rule.on} status={status} />
        {agentFix && rule.on && status.state === 'bad' && (
          <button
            type="button"
            disabled={agentFix.running || agentFix.blocked !== null}
            title={agentFix.blocked ?? t('fixTraceHint')}
            onClick={() => agentFix.run([rule.key])}
            className="shrink-0 text-[11px] font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50"
          >
            {t('fixTrace')}
          </button>
        )}
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

/** How a rule reads now, as its badge says it ("✓", "3 found", "Missing"). */
export function ruleStatusText(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'ok') return '✓';
  if (status.code === 'partOf') return t('partOf', { count: status.count, of: status.of });
  if (status.code === 'current') return formatNumber(status.count);
  if ('count' in status) return t(status.code, { count: status.count });
  return t(status.code);
}

/**
 * The same in full, for the badge's hover and what the agent is told: a
 * length out of its band with the band ("15,921 characters, over 2,400–3,600").
 */
export function ruleStatusDetail(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'bad' && (status.code === 'short' || status.code === 'long')) {
    return t(`${status.code}Detail`, { count: status.count, min: status.min, max: status.max });
  }
  return ruleStatusText(t, status);
}

function StatusBadge({ on, status }: { on: boolean; status: RuleStatus }) {
  const t = useTranslations('contentEditor.editor.rules.status');
  if (!on) {
    return (
      <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">{t('off')}</span>
    );
  }
  const text = ruleStatusText(t, status);
  return (
    <span
      title={ruleStatusDetail(t, status)}
      className={cn(
        'w-20 shrink-0 truncate text-right text-[11px] font-medium',
        status.state === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        status.state === 'bad' && 'text-amber-600 dark:text-amber-400',
        status.state === 'info' && 'font-normal text-muted-foreground',
      )}
    >
      {text}
    </span>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors',
        on ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
          on ? 'left-3.5' : 'left-0.5',
        )}
      />
    </button>
  );
}
