'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Lock, Sparkles, Trash2, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUserRole } from '@/hooks/use-user-role';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface KeyState {
  configured: boolean;
  last4: string | null;
  setAt: string | null;
  setByEmail: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Settings → Agent.
 *
 * Bring-your-own-key UI for the in-product agent on cloud. Customers paste
 * an Anthropic API key here and the chat endpoint reads it back per turn
 * (encrypted at rest, see web/src/lib/agent/key-encryption.ts).
 *
 * The plaintext is never returned from the server — `configured` + `last4`
 * are enough to render the "sk-…abcd" chip without a decrypt round-trip.
 * On save / clear we just refetch.
 */
export function AgentSection() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [state, setState] = useState<KeyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { canAdmin } = useUserRole();
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/anthropic-key');
      const body = (await res.json()) as Partial<KeyState> & { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setState({
        configured: !!body.configured,
        last4: body.last4 ?? null,
        setAt: body.setAt ?? null,
        setByEmail: body.setByEmail ?? null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const apiKey = input.trim();
    if (!apiKey) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/anthropic-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      toast.success('Anthropic API key saved');
      setInput('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const res = await fetch('/api/settings/anthropic-key', { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to clear');
      toast.success('Key removed');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear');
    } finally {
      setClearing(false);
    }
  };

  const configured = state?.configured ?? false;
  const isReplacing = configured && input.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {t('agent')}
        </CardTitle>
        <CardDescription>{t('agent_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : configured && state ? (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {t('agent_keyConfigured')}
              </Badge>
              {state.last4 && (
                <code className="text-xs font-mono text-muted-foreground">sk-…{state.last4}</code>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('agent_savedAt', { date: formatDate(state.setAt) })}
              {state.setByEmail && ` ${t('agent_savedBy', { email: state.setByEmail })}`}.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('agent_noKey')}</p>
        )}

        {canAdmin ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">
                {configured ? t('agent_replaceKey') : t('agent_anthropicKeyLabel')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="anthropic-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('agent_keyPlaceholder')}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={saving}
                  className="font-mono"
                />
                <Button onClick={handleSave} disabled={saving || !input.trim()}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isReplacing ? t('agent_replace') : tCommon('save')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.rich('agent_keyHint', {
                  link: (chunks) => (
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>

            {configured && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmClear(true)}
                  disabled={clearing}
                  className="text-destructive hover:text-destructive"
                >
                  {clearing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {t('agent_removeKey')}
                </Button>
                <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>{t('agent_removeKey')}</DialogTitle>
                      <DialogDescription>{t('agent_removeKeyConfirm')}</DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                      <DialogClose render={<Button variant="outline" />}>
                        {tCommon('cancel')}
                      </DialogClose>

                      <Button
                        type="button"
                        variant="destructive"
                        disabled={clearing}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleClear();
                        }}
                      >
                        {clearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('remove')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </>
        ) : (
          // Server-side, `/api/settings/anthropic-key` PUT/DELETE already
          // refuses non-admin role with a 403. The form here used to render
          // anyway and any click ended in an unhelpful toast — replace it
          // with an explicit read-only message so non-admins know why.
          <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('agent_adminOnly')}</p>
              <p className="mt-1 text-muted-foreground">{t('agent_adminOnlyHint')}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
