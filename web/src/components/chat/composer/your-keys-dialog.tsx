'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddKeyCard } from '@/components/chat/run/add-key-card';
import {
  KEY_USES,
  isAiProvider,
  keyUsesOf,
  makesImages,
  type AiProvider,
  type AiProviderSettings,
  type KeyUse,
} from '@/lib/agent/providers';
import { cn } from '@/lib/utils';

const AI_PROVIDERS_HREF = '/dashboard/settings/ai-providers';

interface KeyRow {
  provider: AiProvider;
  last4: string | null;
  settings: AiProviderSettings;
  /** Auto runs on it (the key Chat uses). */
  active: boolean;
  health: { failingSince: string | null };
}

type Tested = 'working' | 'no_credit' | 'unchecked' | 'refused';

/** The workspace's saved keys, as Settings › AI Providers lists them; 'failed' when unread. */
async function readKeys(): Promise<KeyRow[] | 'failed'> {
  try {
    const res = await fetch('/api/settings/ai-providers');
    const body = (await res.json().catch(() => null)) as { providers?: KeyRow[] } | null;
    return res.ok && body?.providers
      ? body.providers.filter((row) => isAiProvider(row.provider))
      : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * "Your API keys" (CHAT-16 items 19–21, W4-06): Settings › AI Providers'
 * keys, opened from the model menu. Each key with its last four
 * characters, whether Auto runs on it, what it is for (Chat, Images; a
 * picked model runs on its provider's key, then the OpenRouter key, then
 * Ansvisor's), Test, and Add API key. Admins only, on Enterprise or with a
 * key kept from before Chat; the full page stays in Settings.
 */
export function YourKeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('chatKeys');
  const tProviders = useTranslations('settings.agent_providers');
  const [rows, setRows] = useState<KeyRow[] | null | 'failed'>(null);
  const [adding, setAdding] = useState(false);
  const [tested, setTested] = useState<Partial<Record<AiProvider, Tested | 'testing'>>>({});
  const [error, setError] = useState<string | null>(null);

  // Read each time it opens; again after a key is added.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void readKeys().then((next) => {
      if (!stale) setRows(next);
    });
    return () => {
      stale = true;
    };
  }, [open, reads]);

  async function setUses(row: KeyRow, useFor: KeyUse[]) {
    if (useFor.length === 0) return;
    setError(null);
    const res = await fetch('/api/settings/ai-providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: row.provider, useFor }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('failed'));
      return;
    }
    setRows((all) =>
      Array.isArray(all)
        ? all.map((r) =>
            r.provider === row.provider ? { ...r, settings: { ...r.settings, useFor } } : r,
          )
        : all,
    );
  }

  async function test(provider: AiProvider) {
    setTested((all) => ({ ...all, [provider]: 'testing' }));
    const res = await fetch('/api/settings/ai-providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      outcome?: 'working' | 'unknown' | 'failing';
      class?: string;
    } | null;
    const check: Tested =
      body?.outcome === 'working'
        ? 'working'
        : body?.outcome === 'failing'
          ? body.class === 'no_credit'
            ? 'no_credit'
            : 'refused'
          : 'unchecked';
    setTested((all) => ({ ...all, [provider]: check }));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-slot="your-keys" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('yourKeys')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('routing')}</p>
        {rows === null && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
        {rows === 'failed' && <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>}
        {Array.isArray(rows) && rows.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        )}
        {Array.isArray(rows) && rows.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {rows.map((row) => {
              const uses = keyUsesOf(row.provider, row.settings);
              const result = tested[row.provider];
              return (
                <li
                  key={row.provider}
                  data-provider={row.provider}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[13px]"
                >
                  <span className="font-medium">{tProviders(`${row.provider}.name`)}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    ••••{row.last4 ?? ''}
                  </span>
                  {row.active && (
                    <i className="rounded-[5px] border px-1 text-[10px] text-muted-foreground not-italic">
                      {t('autoRunsOnIt')}
                    </i>
                  )}
                  {row.health.failingSince && (
                    <span className="text-xs text-red-700 dark:text-red-400">{t('failing')}</span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    {KEY_USES.map((use) => {
                      const on = uses.includes(use);
                      const off = use === 'images' && !makesImages(row.provider);
                      return (
                        <button
                          key={use}
                          type="button"
                          aria-pressed={on}
                          disabled={off}
                          title={off ? t('noImages') : undefined}
                          data-action={`yourKeys.use.${use}`}
                          onClick={() =>
                            void setUses(row, on ? uses.filter((u) => u !== use) : [...uses, use])
                          }
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
                            on && 'border-foreground/40 bg-muted text-foreground',
                          )}
                        >
                          {t(use === 'chat' ? 'useChat' : 'useImages')}
                        </button>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-action="yourKeys.test"
                      disabled={result === 'testing'}
                      onClick={() => void test(row.provider)}
                    >
                      {result === 'testing' ? t('testing') : t('test')}
                    </Button>
                  </span>
                  {result && result !== 'testing' && (
                    <p
                      role="status"
                      className={cn(
                        'w-full text-xs',
                        result === 'working'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-800 dark:text-amber-300',
                      )}
                    >
                      {t(`tested.${result}`)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        {adding ? (
          <AddKeyCard onClose={() => setAdding(false)} onSaved={() => setReads((n) => n + 1)} />
        ) : (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              data-action="yourKeys.add"
              onClick={() => setAdding(true)}
            >
              {t('add')}
            </Button>
            <Link
              href={AI_PROVIDERS_HREF}
              data-action="yourKeys.settings"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t('settings')}
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
