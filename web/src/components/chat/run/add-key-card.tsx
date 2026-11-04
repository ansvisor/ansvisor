'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/use-user-role';
import { makesImages, type KeyUse } from '@/lib/agent/providers';
import type { PastedKeyProvider } from '@/lib/chat/key-paste';
import { cn } from '@/lib/utils';

/** The providers the card adds (Azure needs its endpoint: Settings › AI Providers). */
export const CARD_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter'] as const;
export type CardProvider = (typeof CARD_PROVIDERS)[number];

/** OpenRouter's key runs the model it names; Chat's writer by default. */
const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const AI_PROVIDERS_HREF = '/dashboard/settings/ai-providers';

/** What the person may do with own keys, as Settings › AI Providers answers it. */
type Access = { state: 'open' | 'plan' | 'locked' } | { state: 'kept'; until: string | null };

type Saved = 'working' | 'no_credit' | 'unchecked';

/**
 * "Add API key" (CHAT-16 items 19–21, W4-06): a form, never a tool call.
 * The key goes from this form to Settings › AI Providers' own route, which
 * tests it before it keeps it; it never reaches the model, the chat or a
 * log. Provider, the key in a masked field, what it is for (Chat, Images;
 * Anthropic's is for Chat only) and Test & save. Admins on Enterprise (or
 * with a key kept from before Chat); everyone else reads why not.
 */
export function AddKeyCard({
  initial,
  onClose,
  onSaved,
}: {
  /** A key pasted into the composer (W4-05's Save securely), and its provider. */
  initial?: { provider?: PastedKeyProvider; key?: string };
  onClose: () => void;
  onSaved?: (provider: CardProvider) => void;
}) {
  const t = useTranslations('chatKeys');
  const tProviders = useTranslations('settings.agent_providers');
  const { canAdmin } = useUserRole();
  const fieldId = useId();
  const [access, setAccess] = useState<Access | null | 'failed'>(null);
  const [provider, setProvider] = useState<CardProvider>(initial?.provider ?? 'openai');
  const [apiKey, setApiKey] = useState(initial?.key ?? '');
  const [model, setModel] = useState(OPENROUTER_DEFAULT_MODEL);
  const [uses, setUses] = useState<KeyUse[]>(['chat']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    let stale = false;
    void fetch('/api/settings/ai-providers')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { access?: Access } | null) => {
        if (!stale) setAccess(body?.access ?? 'failed');
      })
      .catch(() => {
        if (!stale) setAccess('failed');
      });
    return () => {
      stale = true;
    };
  }, []);

  const allowed = access !== null && access !== 'failed' && access.state !== 'locked' && canAdmin;
  // Anthropic has no image models: its key is for Chat.
  const shownUses = uses.filter((use) => use !== 'images' || makesImages(provider));

  function toggle(use: KeyUse) {
    setUses((all) => (all.includes(use) ? all.filter((u) => u !== use) : [...all, use]));
  }

  async function save() {
    if (saving || !apiKey.trim() || shownUses.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
          settings: { useFor: shownUses, ...(provider === 'openrouter' ? { model } : {}) },
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        check?: Saved;
      } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? t('failed'));
        return;
      }
      // Kept: the field is cleared, and only its outcome shows.
      setApiKey('');
      setSaved(body.check ?? 'unchecked');
      onSaved?.(provider);
    } catch {
      setError(t('failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-slot="add-key-card"
      aria-label={t('title')}
      className="rounded-[14px] border bg-card p-3 text-[13px] text-card-foreground shadow-[0_1px_2px_rgba(10,10,10,.04)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <button
          type="button"
          data-action="addKey.close"
          aria-label={t('close')}
          onClick={onClose}
          className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {access === null && <p className="text-muted-foreground">{t('loading')}</p>}
      {access === 'failed' && <p className="text-muted-foreground">{t('loadFailed')}</p>}
      {access !== null && access !== 'failed' && !allowed && (
        <p className="text-muted-foreground">
          {access.state === 'locked' ? t('needsEnterprise') : t('askAdmin')}
        </p>
      )}
      {allowed && saved && (
        <p role="status" className="flex items-center gap-1.5">
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t(`saved.${saved}`, { provider: tProviders(`${provider}.name`) })}
        </p>
      )}
      {allowed && !saved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-2.5"
        >
          <p className="text-xs text-muted-foreground">{t('note')}</p>
          <div role="radiogroup" aria-label={t('provider')} className="flex flex-wrap gap-1.5">
            {CARD_PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={provider === p}
                data-action="addKey.provider"
                data-provider={p}
                onClick={() => setProvider(p)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs text-muted-foreground hover:bg-muted',
                  provider === p && 'border-foreground/40 bg-muted font-medium text-foreground',
                )}
              >
                {tProviders(`${p}.name`)}
              </button>
            ))}
          </div>
          <label htmlFor={`${fieldId}-key`} className="text-xs font-medium">
            {t('key')}
          </label>
          <input
            id={`${fieldId}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-action="addKey.key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('keyPlaceholder')}
            className="ph-no-capture h-8 rounded-lg border bg-background px-2.5 font-mono text-xs outline-none focus:border-foreground/30"
          />
          {provider === 'openrouter' && (
            <>
              <label htmlFor={`${fieldId}-model`} className="text-xs font-medium">
                {t('model')}
              </label>
              <input
                id={`${fieldId}-model`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-8 rounded-lg border bg-background px-2.5 font-mono text-xs outline-none focus:border-foreground/30"
              />
            </>
          )}
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs font-medium">{t('useFor')}</legend>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                data-action="addKey.useChat"
                checked={uses.includes('chat')}
                onChange={() => toggle('chat')}
              />
              {t('useChat')}
            </label>
            <label
              className={cn(
                'inline-flex items-center gap-1.5 text-xs',
                !makesImages(provider) && 'text-muted-foreground',
              )}
            >
              <input
                type="checkbox"
                data-action="addKey.useImages"
                disabled={!makesImages(provider)}
                checked={shownUses.includes('images')}
                onChange={() => toggle('images')}
              />
              {t('useImages')}
            </label>
            {!makesImages(provider) && (
              <span className="text-xs text-muted-foreground">{t('noImages')}</span>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              data-action="addKey.save"
              disabled={saving || !apiKey.trim() || shownUses.length === 0}
            >
              {saving ? t('saving') : t('save')}
            </Button>
            <Link
              href={AI_PROVIDERS_HREF}
              data-action="addKey.settings"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t('settings')}
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
