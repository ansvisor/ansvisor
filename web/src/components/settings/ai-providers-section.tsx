'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, Cloud, Loader2, Lock, Route, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AIProviderAvatar } from '@/components/ai-provider-avatar';
import { useUserRole } from '@/hooks/use-user-role';
import { formatDate } from '@/lib/format';
import {
  AI_PROVIDERS,
  DEFAULT_MODELS,
  OPENROUTER_MODEL_EXAMPLE,
  chatModelId,
  parseProviderSettings,
  type AiProvider,
  type AiProviderSettings,
  type SettingsError,
} from '@/lib/agent/providers';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SavedProvider {
  provider: AiProvider;
  last4: string | null;
  settings: AiProviderSettings;
  active: boolean;
  setAt: string | null;
  setByEmail: string | null;
}

/** Where each provider hands out keys. */
const KEY_LINKS: Record<AiProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  azure: 'https://portal.azure.com/',
  openrouter: 'https://openrouter.ai/settings/keys',
};

function ProviderIcon({ provider }: { provider: AiProvider }) {
  if (provider === 'azure') return <Cloud className="h-5 w-5 text-muted-foreground" />;
  if (provider === 'openrouter') return <Route className="h-5 w-5 text-muted-foreground" />;
  // The same logos as the platforms' (OpenAI's drawn black on a light card).
  return <AIProviderAvatar provider={provider} plain />;
}

/**
 * Settings › AI Providers.
 *
 * Bring-your-own-key UI for the in-product agent on cloud. Customers add a
 * key for one or more providers — Anthropic, OpenAI, Google Gemini,
 * Microsoft Azure OpenAI, OpenRouter — and pick the one Chat uses; the chat
 * endpoint reads it back per turn (encrypted at rest, see
 * web/src/lib/agent/key-encryption.ts).
 *
 * The plaintext is never returned from the server — `last4` is enough to
 * render the "…abcd" chip without a decrypt round-trip. On every change we
 * just refetch.
 */
export function AiProvidersSection() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { canAdmin } = useUserRole();
  const [saved, setSaved] = useState<SavedProvider[] | null>(null);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [switching, setSwitching] = useState<AiProvider | null>(null);
  // The key the remove dialog asks about; kept while the dialog fades out.
  const [confirmRemove, setConfirmRemove] = useState<AiProvider | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const name = (provider: AiProvider) => t(`agent_providers.${provider}.name`);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai-providers');
      const body = (await res.json()) as { providers?: SavedProvider[]; error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setSaved(body.providers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
      setSaved((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUse = async (provider: AiProvider) => {
    setSwitching(provider);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      toast.success(t('agent_switched', { provider: name(provider) }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSwitching(null);
    }
  };

  const handleRemove = async (provider: AiProvider) => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/settings/ai-providers?provider=${provider}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to clear');
      toast.success(t('agent_removed'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear');
    } finally {
      setRemoving(false);
      setRemoveOpen(false);
    }
  };

  const byProvider = new Map((saved ?? []).map((row) => [row.provider, row]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {t('aiProviders')}
        </CardTitle>
        <CardDescription>{t('agent_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved === null ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            {!saved.some((row) => row.active) && (
              <p className="text-sm text-muted-foreground">{t('agent_noKey')}</p>
            )}
            <div className="divide-y rounded-lg border">
              {AI_PROVIDERS.map((provider) => {
                const row = byProvider.get(provider);
                return (
                  <div key={provider} className="@container space-y-4 p-4" data-provider={provider}>
                    <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                          <ProviderIcon provider={provider} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{name(provider)}</p>
                            {row?.active ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                {t('agent_usedByChat')}
                              </Badge>
                            ) : (
                              row && <Badge variant="secondary">{t('agent_keySaved')}</Badge>
                            )}
                          </div>
                          {row ? (
                            <p className="text-xs text-muted-foreground">
                              {row.last4 && <code className="font-mono">…{row.last4}</code>}
                              {' · '}
                              {t('agent_modelInUse', {
                                model: chatModelId(provider, row.settings),
                              })}
                              {' · '}
                              {t('agent_savedAt', { date: formatDate(row.setAt) })}
                              {row.setByEmail &&
                                ` ${t('agent_savedBy', { email: row.setByEmail })}`}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t(`agent_providers.${provider}.about`)}
                            </p>
                          )}
                        </div>
                      </div>

                      {canAdmin && editing !== provider && (
                        <div className="flex shrink-0 items-center gap-2 pl-13 @lg:pl-0">
                          {row && !row.active && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={switching !== null}
                              onClick={() => void handleUse(provider)}
                            >
                              {switching === provider && (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              )}
                              {t('agent_useForChat')}
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setEditing(provider)}>
                            {row ? t('agent_replace') : t('agent_addKey')}
                          </Button>
                          {row && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${t('agent_removeKey')}: ${name(provider)}`}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setConfirmRemove(provider);
                                setRemoveOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {canAdmin && editing === provider && (
                      <ProviderKeyForm
                        provider={provider}
                        saved={row?.settings ?? {}}
                        onCancel={() => setEditing(null)}
                        onSaved={async () => {
                          // Closed once the row shows the new key, not before.
                          await load();
                          setEditing(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!canAdmin && (
          // Server-side, `/api/settings/ai-providers` PUT/PATCH/DELETE
          // already refuse a non-admin role with a 403 — say so up front
          // instead of offering buttons that end in an unhelpful toast.
          <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('agent_adminOnly')}</p>
              <p className="mt-1 text-muted-foreground">{t('agent_adminOnlyHint')}</p>
            </div>
          </div>
        )}

        <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('agent_removeKey')}</DialogTitle>
              <DialogDescription>
                {confirmRemove && t('agent_removeKeyConfirm', { provider: name(confirmRemove) })}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{tCommon('cancel')}</DialogClose>

              <Button
                type="button"
                variant="destructive"
                disabled={removing}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmRemove) void handleRemove(confirmRemove);
                }}
              >
                {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('remove')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** A provider's key, and the settings it needs besides, saved together. */
function ProviderKeyForm({
  provider,
  saved,
  onCancel,
  onSaved,
}: {
  provider: AiProvider;
  saved: AiProviderSettings;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(saved.endpoint ?? '');
  const [deployment, setDeployment] = useState(saved.deployment ?? '');
  const [model, setModel] = useState(saved.model ?? '');
  const [invalid, setInvalid] = useState<SettingsError | null>(null);
  const [saving, setSaving] = useState(false);
  const id = (field: string) => `ai-provider-${provider}-${field}`;

  const handleSave = async () => {
    const settings = provider === 'azure' ? { endpoint, deployment } : { model };
    const parsed = parseProviderSettings(provider, settings);
    if ('error' in parsed) {
      setInvalid(parsed.error);
      return;
    }
    setInvalid(null);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), settings: parsed.settings }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: SettingsError;
      };
      if (body.field) {
        setInvalid(body.field);
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      toast.success(t('agent_saved', { provider: t(`agent_providers.${provider}.name`) }));
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (field: SettingsError) =>
    invalid === field && <p className="text-xs text-destructive">{t(`agent_invalid.${field}`)}</p>;

  return (
    <form
      className="space-y-3 rounded-md border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={id('key')}>{t('agent_apiKeyLabel')}</Label>
        <Input
          id={id('key')}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(`agent_providers.${provider}.keyPlaceholder`)}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={saving}
          className="bg-card font-mono"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          {t.rich(`agent_providers.${provider}.keyHint`, {
            link: (chunks) => (
              <a href={KEY_LINKS[provider]} target="_blank" rel="noreferrer" className="underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>

      {provider === 'azure' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={id('endpoint')}>{t('agent_endpointLabel')}</Label>
            <Input
              id={id('endpoint')}
              spellCheck={false}
              placeholder={t('agent_endpointPlaceholder')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={saving}
              aria-invalid={invalid === 'endpoint'}
              className="bg-card"
            />
            {fieldError('endpoint')}
          </div>
          <div className="space-y-2">
            <Label htmlFor={id('deployment')}>{t('agent_deploymentLabel')}</Label>
            <Input
              id={id('deployment')}
              spellCheck={false}
              placeholder={t('agent_deploymentPlaceholder')}
              value={deployment}
              onChange={(e) => setDeployment(e.target.value)}
              disabled={saving}
              aria-invalid={invalid === 'deployment'}
              className="bg-card"
            />
            {fieldError('deployment')}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={id('model')}>{t('agent_modelLabel')}</Label>
          <Input
            id={id('model')}
            spellCheck={false}
            placeholder={
              provider === 'openrouter' ? OPENROUTER_MODEL_EXAMPLE : DEFAULT_MODELS[provider]
            }
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={saving}
            aria-invalid={invalid === 'model'}
            className="bg-card font-mono"
          />
          {fieldError('model') || (
            <p className="text-xs text-muted-foreground">
              {provider === 'openrouter'
                ? t('agent_openrouterModelHint', { model: OPENROUTER_MODEL_EXAMPLE })
                : t('agent_modelOptional', { model: DEFAULT_MODELS[provider] })}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || !apiKey.trim()}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
