'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Link } from '@/i18n/navigation';
import { MAX_MEMORY_LINE, MEMORY_UNDO_MS, type MemoryScope } from '@/lib/chat/memory/rules';
import type { MemoryItemView, MemoryList } from '@/lib/chat/memory/store';
import { stampParts } from '@/lib/chat/stamp';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { FormSwitch } from './agents/agent-form-triggers';

/**
 * Memory (CHAT-14 items 21–25; W3-12b), from the chat header's ⋯: what
 * Chat remembers between chats. Tabs with their counts, Me, Brand: {the
 * brand in the brand switcher} and Workspace; a table of Memory, Source,
 * Updated, with Edit (inline, with its counter) and Delete (at once, Undo
 * for 10 seconds) where the person's role changes that scope, and off where
 * it doesn't. The Brand tab also shows the brand's rules, read-only, from
 * Settings › Content. "Use memory" is the person's own switch; the
 * workspace's is an Admin's, in Settings › Chat.
 */

/** The table's columns: memory · source · updated · actions. */
const COLS =
  'grid grid-cols-[minmax(0,1fr)_150px_120px_72px] items-start gap-3 px-3.5 max-[900px]:grid-cols-[minmax(0,1fr)_72px]';
const HIDE_NARROW = 'max-[900px]:hidden';
const ICON =
  'flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none';

const SCOPES: MemoryScope[] = ['user', 'brand', 'workspace'];

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: MemoryList };

/** A refusal's words from the API, or the page's own. */
async function refusalOf(res: Response | null, fallback: string): Promise<string> {
  const body = res ? ((await res.json().catch(() => null)) as { error?: unknown } | null) : null;
  return typeof body?.error === 'string' ? body.error : fallback;
}

export function ChatMemory() {
  const t = useTranslations('chatMemory.page');
  const tCard = useTranslations('chatMemory.card');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [tab, setTab] = useState<MemoryScope>('user');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Read again after a change: the list for the brand in the switcher, the last read wins.
  const [version, setVersion] = useState(0);
  const read = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    const query = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : '';
    void (async () => {
      const res = await fetch(`/api/chat/memory${query}`).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as MemoryList | null) : null;
      if (live) setLoad(body ? { status: 'ready', list: body } : { status: 'error' });
    })();
    return () => {
      live = false;
    };
  }, [brandId, version]);

  const list = load.status === 'ready' ? load.list : null;

  /**
   * Turns the person's own "Use memory" (item 24): shown at once, put back
   * when it isn't kept. Open on a read-only workspace too: the person's own
   * data (KVKK/GDPR).
   */
  const setPersonal = async (next: boolean) => {
    if (!list) return;
    setLoad({
      status: 'ready',
      list: { ...list, switches: { ...list.switches, personal: next } },
    });
    const res = await fetch('/api/chat/memory/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personal: next }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(await refusalOf(res, t('failed')));
      read();
    }
  };

  const save = guard(
    async () => {
      if (!editing || busy) return;
      setBusy(true);
      const res = await fetch(`/api/chat/memory/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editing.text }),
      }).catch(() => null);
      setBusy(false);
      if (!res?.ok) {
        toast.error(await refusalOf(res, t('failed')));
        return;
      }
      setEditing(null);
      toast.success(t('saved'));
      read();
    },
    { action: tActions('changeChatSettings') },
  );

  const restore = useCallback(
    async (item: MemoryItemView) => {
      const res = await fetch(`/api/chat/memory/${item.id}/restore`, { method: 'POST' }).catch(
        () => null,
      );
      if (!res?.ok) {
        toast.error(await refusalOf(res, t('failed')));
        return;
      }
      toast(t('restored'));
      read();
    },
    [read, t],
  );

  /** Deletes at once (item 23): the row goes, and Undo brings it back for 10 seconds. */
  const removeNow = async (item: MemoryItemView) => {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/chat/memory/${item.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast.error(await refusalOf(res, t('failed')));
      return;
    }
    if (list) {
      setLoad({
        status: 'ready',
        list: {
          ...list,
          items: {
            ...list.items,
            [item.scope]: list.items[item.scope].filter((i) => i.id !== item.id),
          },
          used: { ...list.used, [item.scope]: list.used[item.scope] - item.text.length },
        },
      });
    }
    toast(t('deleted'), {
      duration: MEMORY_UNDO_MS,
      action: { label: t('undo'), onClick: () => void restore(item) },
    });
  };
  /**
   * A person's own Me line is deleted on a read-only workspace too (their
   * personal data, KVKK/GDPR); a Brand or Workspace line waits for a plan.
   */
  const remove = (item: MemoryItemView) =>
    item.scope === 'user'
      ? removeNow(item)
      : guard(removeNow, { action: tActions('changeChatSettings') })(item);

  const tabLabel = (scope: MemoryScope) =>
    scope === 'brand'
      ? list?.brand
        ? t('tabs.brand', { brand: list.brand.name })
        : t('tabs.brandNone')
      : t(`tabs.${scope}`);
  const count = (scope: MemoryScope) =>
    (list?.items[scope].length ?? 0) + (scope === 'brand' ? (list?.brandRules.length ?? 0) : 0);

  const rights = list?.rights[tab] ?? null;
  const items = list?.items[tab] ?? [];
  const rules = tab === 'brand' ? (list?.brandRules ?? []) : [];
  const workspaceOff = list ? !list.switches.workspace : false;
  // Off for the workspace: only an Admin sees the notes (item 24).
  const hidden = workspaceOff && !list?.canSwitchWorkspace;

  return (
    <div className="max-w-[1100px]">
      <div className="mb-3.5 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        {list && !hidden && (
          <div className="ml-auto flex items-center gap-2.5 text-[13px]">
            <span className="text-right">
              {t('useMemory')}
              <span className="block text-xs text-muted-foreground">{t('useMemoryNote')}</span>
            </span>
            <FormSwitch
              checked={list.switches.personal}
              label={t('useMemory')}
              action="memory.useMemory"
              onChange={(next) => void setPersonal(next)}
            />
          </div>
        )}
      </div>

      {list && workspaceOff && (
        <p
          role="status"
          data-slot="memory-off"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {list.canSwitchWorkspace ? t('offAdmin') : t('off')}
        </p>
      )}
      {list && !workspaceOff && !list.switches.personal && (
        <p
          role="status"
          data-slot="memory-personal-off"
          className="mb-3 rounded-lg border bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground"
        >
          {t('personalOff')}
        </p>
      )}

      {!hidden && (
        <>
          <div
            role="tablist"
            aria-label={t('title')}
            className="mb-3 flex flex-wrap items-center gap-1.5"
          >
            {SCOPES.map((scope) => (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={tab === scope}
                data-action="memory.tab"
                data-scope={scope}
                onClick={() => {
                  setTab(scope);
                  setEditing(null);
                }}
                className={cn(
                  'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === scope && 'border-foreground/40 bg-muted font-medium text-foreground',
                )}
              >
                {tabLabel(scope)}
                {list && (
                  <i className="ml-1 rounded-md bg-foreground/10 px-[5px] text-[11px] font-medium not-italic text-foreground/80 tabular-nums">
                    {count(scope)}
                  </i>
                )}
              </button>
            ))}
            {list && (tab !== 'brand' || list.brand) && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {t('used', {
                  used: list.used[tab].toLocaleString('en-US'),
                  max: list.limits.scope.toLocaleString('en-US'),
                })}
              </span>
            )}
          </div>

          {list && rights !== 'edit' && (tab !== 'brand' || list.brand) && (
            <p className="mb-2 text-xs text-muted-foreground">
              {tab === 'workspace'
                ? t(rights === 'request' ? 'readOnly.workspaceRequest' : 'readOnly.workspace')
                : t('readOnly.brand')}
            </p>
          )}

          <div role="tabpanel" className="overflow-hidden rounded-[14px] border">
            <div
              className={cn(
                COLS,
                'bg-muted/50 py-2.5 text-[11px] tracking-[.3px] text-muted-foreground uppercase max-[900px]:hidden',
              )}
            >
              <span>{t('columns.memory')}</span>
              <span>{t('columns.source')}</span>
              <span>{t('columns.updated')}</span>
              <span />
            </div>
            {load.status === 'loading' && (
              <div aria-hidden className="flex flex-col gap-2 border-t p-3.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {load.status === 'error' && (
              <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
                {t('loadFailed')}{' '}
                <button
                  type="button"
                  data-action="memory.retry"
                  onClick={() => void read()}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {list &&
              items.map((item) => {
                const at = stampParts(item.updatedAt);
                const open = editing?.id === item.id;
                return (
                  <div
                    key={item.id}
                    data-slot="memory-row"
                    className={cn(COLS, 'min-h-[48px] border-t py-2.5 text-sm')}
                  >
                    {open ? (
                      <div className="grid gap-1.5 max-[900px]:col-span-2">
                        <Textarea
                          data-action="memory.editText"
                          aria-label={t('columns.memory')}
                          value={editing.text}
                          maxLength={MAX_MEMORY_LINE}
                          disabled={busy}
                          autoFocus
                          onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                          className="min-h-14 text-[13px]"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {tCard('counter', {
                              count: editing.text.trim().length,
                              max: MAX_MEMORY_LINE,
                            })}
                          </span>
                          <span className="ml-auto flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              data-action="memory.cancel"
                              disabled={busy}
                              onClick={() => setEditing(null)}
                            >
                              {t('cancel')}
                            </Button>
                            <Button
                              size="sm"
                              data-action="memory.save"
                              disabled={busy || !editing.text.trim()}
                              onClick={() => void save()}
                            >
                              {t('save')}
                            </Button>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="min-w-0 break-words">{item.text}</span>
                    )}
                    {!open && (
                      <>
                        <span className={cn('text-[13px] text-muted-foreground', HIDE_NARROW)}>
                          {t(`sources.${item.source}`)}
                        </span>
                        <span
                          className={cn('text-[13px] text-muted-foreground', HIDE_NARROW)}
                          title={`${at.date} · ${at.time} ${at.offset}`}
                        >
                          {at.date}
                        </span>
                        <span className="flex justify-end gap-0.5">
                          <button
                            type="button"
                            data-action="memory.edit"
                            aria-label={t('edit', { text: item.text })}
                            disabled={!item.can.edit || busy}
                            onClick={() => setEditing({ id: item.id, text: item.text })}
                            className={ICON}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            data-action="memory.delete"
                            aria-label={t('delete', { text: item.text })}
                            disabled={!item.can.remove || busy}
                            onClick={() => void remove(item)}
                            className={ICON}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            {list &&
              rules.map((rule, i) => (
                <div
                  key={`rule-${i}`}
                  data-slot="memory-brand-rule"
                  className={cn(COLS, 'min-h-[48px] border-t py-2.5 text-sm')}
                >
                  <span className="min-w-0 break-words">{rule}</span>
                  <span className={cn('text-[13px] text-muted-foreground', HIDE_NARROW)}>
                    {t('sources.brandRules')}
                  </span>
                  <span className={HIDE_NARROW} />
                  <span className="flex justify-end">
                    <Link
                      href="/dashboard/settings/content"
                      data-action="memory.editRules"
                      aria-label={t('editRules')}
                      title={t('editRules')}
                      className={ICON}
                    >
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </span>
                </div>
              ))}
            {list && items.length === 0 && rules.length === 0 && (
              <p
                data-slot="memory-empty"
                className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground"
              >
                {tab === 'brand'
                  ? list.brand
                    ? t('empty.brand', { brand: list.brand.name })
                    : t('empty.brandNone')
                  : t(`empty.${tab}`)}
              </p>
            )}
          </div>
          {list && rules.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{t('brandRulesNote')}</p>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">{t('addNote')}</p>
        </>
      )}
    </div>
  );
}
