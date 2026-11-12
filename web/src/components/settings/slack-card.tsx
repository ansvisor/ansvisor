'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Hash, Loader2, Lock, Slack, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsSwitch } from '@/components/chat-access/settings-switch';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { DEMO_SLACK_CHANNEL, demoIntegration } from '@/lib/demo/integrations';
import { formatDate } from '@/lib/format';
import {
  SLACK_SHOWN_KINDS,
  activateSlack,
  chooseSlackWorkspace,
  disconnectSlack,
  listSlackChannels,
  readSlack,
  saveSlack,
  sendSlackTest,
  startSlackConnect,
  type SlackCardRead,
  type SlackChannelOption,
  type SlackError,
  type SlackSendKind,
} from '@/lib/slack-client';
import { useBrandStore } from '@/stores/use-brand-store';
import { SampleDataBadge } from './sample-data-badge';

/** How long Slack's install waits for Composio to report the account active. */
const CONNECT_DEADLINE_MS = 120_000;
const CONNECT_POLL_MS = 3000;

const WARN_BADGE =
  'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' as const;
const OK_BADGE =
  'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' as const;

/** A channel in the picker: what base-ui's Combobox filters and shows. */
interface ChannelItem {
  value: string;
  label: string;
  private: boolean;
  members: number | null;
}

const itemOf = (c: { id: string; name: string; private: boolean; members?: number | null }) => ({
  value: c.id,
  label: c.name,
  private: c.private,
  members: c.members ?? null,
});

/**
 * Settings › Integrations › Slack (#2139): where the active brand's Daily
 * Pulse is posted (the drop alerts, the daily suggestion and agents that
 * need someone join it, each with its switch).
 * Admins and managers who can access the brand connect a Slack workspace
 * (Slack's install of the Ansvisor app, in a popup), or use the workspace
 * another brand uses, pick the channel and what goes to it, send a test
 * message and disconnect. Others see where messages go.
 *
 * The workspace is posted to only while whoever connected it can see the
 * brand; when they can't, or Slack refuses the connection, the card says
 * so and offers to reconnect. On the demo brand, it shows connected with
 * sample data, and its buttons open the plan dialog.
 */
export function SlackCard() {
  const t = useTranslations('settings.slack');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;
  const { isDemo } = useDemoBrand();
  const demo = isDemo && demoIntegration('slack') === 'connected';

  // The read, for the brand it was made for: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    card: SlackCardRead | null;
    failed: boolean;
  } | null>(null);
  const [reads, setReads] = useState(0);
  const reload = useCallback(() => setReads((n) => n + 1), []);
  const [busy, setBusy] = useState<'connect' | 'use' | 'test' | 'disconnect' | null>(null);
  const pollGen = useRef(0);

  useEffect(() => {
    if (!activeBrandId || demo) return;
    let live = true;
    void readSlack(activeBrandId).then((result) => {
      if (!live) return;
      setRead(
        result.ok
          ? { brandId: activeBrandId, card: result, failed: false }
          : { brandId: activeBrandId, card: null, failed: true },
      );
    });
    return () => {
      live = false;
    };
  }, [activeBrandId, reads, demo]);

  // A popup's poll stops when the card goes.
  useEffect(() => {
    const gens = pollGen;
    return () => {
      gens.current++;
    };
  }, []);

  const current = read?.brandId === activeBrandId ? read : null;
  const card = current?.card ?? null;
  const setCard = (next: SlackCardRead) =>
    setRead((r) => (r && r.brandId === activeBrandId ? { ...r, card: next } : r));

  /** A refusal said once: the plan dialog for a plan or a read-only workspace, else a toast. */
  const refused = (code: SlackError) => {
    if (code === 'subscription' || code === 'plan') openUpgrade(tActions('connectIntegrations'));
    else toast.error(t(`errors.${errorKey(code)}`));
  };

  async function connect() {
    if (!activeBrandId) return;
    if (card && !card.allowed) {
      openUpgrade(tActions('connectIntegrations'));
      return;
    }
    const brandId = activeBrandId;
    setBusy('connect');
    const gen = ++pollGen.current;
    try {
      const started = await startSlackConnect(
        brandId,
        `${window.location.origin}${window.location.pathname}`,
      );
      if (!started.ok) {
        refused(started.code);
        return;
      }
      const popup = window.open(started.redirectUrl, 'slack-install', 'width=600,height=760');
      if (!popup) {
        window.location.href = started.redirectUrl;
        return;
      }
      const deadline = Date.now() + CONNECT_DEADLINE_MS;
      while (Date.now() < deadline && pollGen.current === gen) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
        if (pollGen.current !== gen) return;
        const done = await activateSlack(brandId, started.accountId);
        if (done.ok && done.status === 'connected') {
          popup.close();
          toast.success(t('toast.connected'));
          reload();
          return;
        }
        if (popup.closed) break;
      }
      if (pollGen.current === gen) toast.error(t('toast.connectUnfinished'));
    } finally {
      if (pollGen.current === gen) setBusy(null);
    }
  }

  async function pickWorkspace(accountId: string) {
    if (!activeBrandId) return;
    setBusy('use');
    const result = await chooseSlackWorkspace(activeBrandId, accountId);
    setBusy(null);
    if (!result.ok) {
      refused(result.code);
      return;
    }
    setCard(result);
    toast.success(t('toast.switched'));
  }

  async function sendTest() {
    if (!activeBrandId) return;
    setBusy('test');
    const result = await sendSlackTest(activeBrandId);
    setBusy(null);
    if (!result.ok) {
      refused(result.code);
      // The card's state changed with it: a refused workspace, a channel that is gone.
      if (['refused', 'channel_gone', 'access_lost'].includes(result.code)) reload();
      return;
    }
    toast.success(t('toast.testSent', { channel: result.channel.name }));
  }

  async function disconnect() {
    if (!activeBrandId) return;
    setBusy('disconnect');
    const result = await disconnectSlack(activeBrandId);
    setBusy(null);
    if (!result.ok) {
      refused(result.code);
      return;
    }
    toast.success(t('toast.disconnected'));
    reload();
  }

  // The demo brand's sample: connected, posting to a sample channel.
  const shown: SlackCardRead | null = demo
    ? {
        configured: true,
        allowed: true,
        state: 'connected',
        workspace: null,
        channel: { id: 'C0DEMO0001', name: DEMO_SLACK_CHANNEL, private: false },
        send: { pulse: true, drops: true, suggestion: true, needsYou: true },
        usable: [],
      }
    : card;
  const state = shown?.state ?? 'not_connected';
  const posting = state === 'connected' && !!shown?.channel;
  const workspaceName = shown?.workspace?.label ?? t('unnamedWorkspace');
  const brandName = brand?.name ?? '';
  const otherBrands = (ids: string[]) =>
    ids
      .map((id) => brands.find((b) => b.id === id)?.name)
      .filter((name): name is string => Boolean(name));

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4" data-integration="slack">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Slack className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('title')}</p>
            {shown && !shown.configured && (
              <Badge variant="outline" className="text-muted-foreground">
                {t('badges.notConfigured')}
              </Badge>
            )}
            {posting && (
              <Badge variant="outline" className={OK_BADGE}>
                {t('badges.connected')}
              </Badge>
            )}
            {demo && <SampleDataBadge />}
            {state === 'connected' && !shown?.channel && (
              <Badge variant="outline" className={WARN_BADGE}>
                {t('badges.pickChannel')}
              </Badge>
            )}
            {state === 'refused' && (
              <Badge variant="outline" className={WARN_BADGE}>
                {t('badges.reconnect')}
              </Badge>
            )}
            {state === 'access_lost' && (
              <Badge variant="outline" className={WARN_BADGE}>
                {t('badges.paused')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brandName }) : t('noBrand')}
          </p>
          {shown?.workspace && (
            <p className="mt-1 text-xs text-muted-foreground">
              {[
                t('workspace', { workspace: workspaceName }),
                shown.workspace.connectedBy
                  ? t('connectedBy', {
                      name: shown.workspace.connectedBy,
                      date: formatDate(shown.workspace.connectedAt),
                    })
                  : t('connectedOn', { date: formatDate(shown.workspace.connectedAt) }),
                ...(otherBrands(shown.workspace.sharedWith).length
                  ? [
                      t('alsoUsedBy', {
                        brands: otherBrands(shown.workspace.sharedWith).join(', '),
                      }),
                    ]
                  : []),
              ].join(' · ')}
            </p>
          )}
          {canManage && (demo || (state === 'connected' && shown?.configured)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {posting && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={
                    demo
                      ? () => openUpgrade(tActions('connectIntegrations'))
                      : guard(() => void sendTest(), { action: tActions('connectIntegrations') })
                  }
                >
                  {busy === 'test' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('test')}
                </Button>
              )}
              {demo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => openUpgrade(tActions('disconnectIntegrations'))}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  {t('disconnect')}
                </Button>
              ) : (
                <DisconnectButton
                  brand={brandName}
                  busy={busy === 'disconnect'}
                  disabled={busy !== null}
                  onConfirm={() => void disconnect()}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {!activeBrandId ? null : !shown && !current ? (
        <Skeleton className="h-16 w-full" />
      ) : !shown ? (
        <div role="status" className="space-y-2 text-sm text-muted-foreground">
          <p>{t('unavailable')}</p>
          <Button size="sm" variant="outline" onClick={reload}>
            {t('retry')}
          </Button>
        </div>
      ) : !shown.configured ? (
        <p className="text-xs text-muted-foreground">
          {t.rich('notConfigured', {
            code: (chunks) => <code className="rounded bg-muted px-1">{chunks}</code>,
          })}
        </p>
      ) : demo ? (
        <p className="text-sm text-muted-foreground">
          {t('memberPostsTo', { brand: brandName, channel: DEMO_SLACK_CHANNEL })}
        </p>
      ) : !canManage ? (
        <p className="text-sm text-muted-foreground">
          {state === 'not_connected'
            ? t('memberNotConnected')
            : state !== 'connected'
              ? t('memberProblem')
              : shown.channel
                ? t('memberPostsTo', { brand: brandName, channel: shown.channel.name })
                : t('memberNoChannel')}
        </p>
      ) : state === 'connected' ? (
        <ChannelAndSends
          key={`${activeBrandId}:${shown.workspace?.accountId}`}
          brandId={activeBrandId}
          brand={brandName}
          card={shown}
          focus={!shown.channel}
          onSaved={setCard}
          onRefused={(code) => {
            refused(code);
            if (code === 'refused' || code === 'channel_gone' || code === 'access_lost') reload();
          }}
        />
      ) : (
        <div className="space-y-3">
          {state === 'refused' && <Note>{t('refusedNote', { workspace: workspaceName })}</Note>}
          {state === 'access_lost' && (
            <Note>
              {shown.workspace?.connectedBy
                ? t('accessLostNote', { name: shown.workspace.connectedBy, brand: brandName })
                : t('accessLostNoteUnknown', { brand: brandName })}
            </Note>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-2"
              disabled={busy !== null}
              onClick={guard(() => void connect(), { action: tActions('connectIntegrations') })}
            >
              {busy === 'connect' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy === 'connect'
                ? t('connecting')
                : state === 'not_connected'
                  ? t('connect')
                  : t('reconnect')}
            </Button>
            {shown.usable.length > 0 && (
              <Select
                items={shown.usable.map((u) => ({
                  value: u.accountId,
                  label: workspaceOption(u.label ?? t('unnamedWorkspace'), otherBrands(u.brandIds)),
                }))}
                value={null}
                onValueChange={guard((v: string | null) => v && void pickWorkspace(v), {
                  action: tActions('connectIntegrations'),
                })}
                disabled={busy !== null}
              >
                <SelectTrigger size="sm" className="w-72" aria-label={t('useSameLabel')}>
                  {busy === 'use' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SelectValue placeholder={t('useSame')} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {shown.usable.map((u) => (
                    <SelectItem key={u.accountId} value={u.accountId}>
                      {workspaceOption(u.label ?? t('unnamedWorkspace'), otherBrands(u.brandIds))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {state !== 'not_connected' && (
              <DisconnectButton
                brand={brandName}
                busy={busy === 'disconnect'}
                disabled={busy !== null}
                onConfirm={() => void disconnect()}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {busy === 'connect' ? t('connectingNote') : t('connectNote')}
          </p>
        </div>
      )}
    </div>
  );
}

/** "Acme Inc · Contoso, Fabrikam": a workspace, with the brands that post to it. */
function workspaceOption(label: string, brands: string[]) {
  return brands.length ? `${label} · ${brands.join(', ')}` : label;
}

/** The messages' key for a refusal code (en.json settings.slack.errors). */
function errorKey(code: SlackError): string {
  return code === 'subscription' || code === 'plan' ? 'failed' : code;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Disconnect, after the person says so. */
function DisconnectButton({
  brand,
  busy,
  disabled,
  onConfirm,
}: {
  brand: string;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('settings.slack');
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            disabled={disabled}
          />
        }
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Unplug className="h-3.5 w-3.5" />
        )}
        {t('disconnect')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('disconnectTitle', { brand })}</DialogTitle>
          <DialogDescription>{t('disconnectDescription', { brand })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <DialogClose render={<Button variant="destructive" onClick={onConfirm} />}>
            {t('disconnect')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The channel (picked from the workspace's, by search) and what goes to it.
 * The channels are listed when the picker opens, or at once while none is
 * picked yet: the setup's last step.
 */
function ChannelAndSends({
  brandId,
  brand,
  card,
  focus,
  onSaved,
  onRefused,
}: {
  brandId: string;
  brand: string;
  card: SlackCardRead;
  focus: boolean;
  onSaved: (card: SlackCardRead) => void;
  onRefused: (code: SlackError) => void;
}) {
  const t = useTranslations('settings.slack');
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [channels, setChannels] = useState<SlackChannelOption[] | 'loading' | 'failed' | null>(
    null,
  );
  const [saving, setSaving] = useState<'channel' | SlackSendKind | null>(null);

  const loadChannels = useCallback(async () => {
    setChannels('loading');
    const result = await listSlackChannels(brandId);
    if (result.ok) {
      setChannels(result.channels);
      return;
    }
    setChannels('failed');
    if (result.code !== 'failed') onRefused(result.code);
  }, [brandId, onRefused]);

  useEffect(() => {
    if (!focus) return;
    let live = true;
    void listSlackChannels(brandId).then((result) => {
      if (!live) return;
      setChannels(result.ok ? result.channels : 'failed');
    });
    return () => {
      live = false;
    };
  }, [brandId, focus]);

  const items: ChannelItem[] = Array.isArray(channels)
    ? channels.map(itemOf)
    : card.channel
      ? [itemOf(card.channel)]
      : [];
  const picked = card.channel
    ? (items.find((i) => i.value === card.channel?.id) ?? itemOf(card.channel))
    : null;

  async function pick(item: ChannelItem | null) {
    if (!item || item.value === card.channel?.id) return;
    setSaving('channel');
    const result = await saveSlack(brandId, { channelId: item.value });
    setSaving(null);
    if (!result.ok) {
      onRefused(result.code);
      return;
    }
    onSaved(result);
    toast.success(t('toast.channelSaved', { channel: item.label }));
  }

  async function toggle(kind: SlackSendKind, next: boolean) {
    setSaving(kind);
    const result = await saveSlack(brandId, { send: { [kind]: next } });
    setSaving(null);
    if (!result.ok) {
      onRefused(result.code);
      return;
    }
    onSaved(result);
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-16 text-sm text-muted-foreground">{t('channel')}</span>
        <Combobox
          items={items}
          value={picked}
          disabled={saving !== null}
          onOpenChange={(open: boolean) => {
            if (open && channels === null) void loadChannels();
          }}
          onValueChange={guard((item: ChannelItem | null) => void pick(item), {
            action: tActions('connectIntegrations'),
          })}
        >
          <ComboboxTrigger className="w-72" aria-label={t('channel')}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {saving === 'channel' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : picked ? (
                <>
                  {picked.private ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{picked.label}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{t('pickChannel')}</span>
              )}
            </span>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput placeholder={t('searchChannels')} aria-label={t('searchChannels')} />
            <ComboboxList>
              <ComboboxEmpty>
                {channels === 'loading'
                  ? t('loadingChannels')
                  : channels === 'failed'
                    ? t('channelsFailed')
                    : t('noChannels')}
              </ComboboxEmpty>
              <ComboboxCollection>
                {(item: ChannelItem) => (
                  <ComboboxItem key={item.value} value={item} title={item.label}>
                    {item.private ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.members !== null && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('members', { count: item.members })}
                      </span>
                    )}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxList>
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('privateHint')}</p>
          </ComboboxContent>
        </Combobox>
        {channels === 'failed' && (
          <Button variant="ghost" size="sm" onClick={() => void loadChannels()}>
            {t('retry')}
          </Button>
        )}
      </div>
      {!card.channel && (
        <p className="text-xs text-muted-foreground">{t('pickChannelNote', { brand })}</p>
      )}

      <div role="group" aria-label={t('sendLabel')} className="pt-1">
        {SLACK_SHOWN_KINDS.map((kind) => (
          <div
            key={kind}
            className="flex items-center gap-3 border-t py-2.5 text-sm first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              {t(`send.${kind}.label`)}
              <span className="block text-xs text-muted-foreground">{t(`send.${kind}.note`)}</span>
            </div>
            {saving === kind && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <SettingsSwitch
              checked={card.send[kind]}
              label={t(`send.${kind}.label`)}
              disabled={saving !== null}
              onChange={guard((next: boolean) => void toggle(kind, next), {
                action: tActions('connectIntegrations'),
              })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
