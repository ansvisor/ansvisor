'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Check, Crown, Loader2, Unplug, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
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
import { CHOOSE_PLAN_HREF, useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { formatDate } from '@/lib/format';
import {
  activateHubspot,
  chooseHubspotAccount,
  disconnectHubspot,
  listHubspotBlogs,
  readHubspot,
  rememberPending,
  retryHubspotSetup,
  saveHubspotBlog,
  saveHubspotConsent,
  startHubspotConnect,
  takePending,
  type HubspotAccount,
  type HubspotConsent,
  type HubspotError,
  type HubspotRead,
  type HubspotBlog,
} from '@/lib/hubspot-client';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

/** How long the popup's sign-in is waited for, and how often it's checked. */
const CONNECT_DEADLINE_MS = 120_000;
const CONNECT_POLL_MS = 3000;
/** Checks of a sign-in finished in this tab (the popup was blocked), on return. */
const RESUME_TRIES = 5;

/** The property setup refusals the card names; anything else reads as "other". */
const SETUP_ERRORS = ['scopes', 'conflict', 'auth', 'forbidden'] as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Settings › Integrations › CRM › HubSpot (#2140): the active brand's
 * HubSpot account. Growth and above (`crm_integrations`); a connection kept
 * past a downgrade is paused. Admins and managers connect it after choosing
 * what Ansvisor may write (marking AI-sourced contacts, draft pages), use
 * the account another brand uses, change those writes and disconnect;
 * members see the state. HubSpot's sign-in opens in a popup; a blocked popup
 * goes to HubSpot in this tab, and the card finishes the sign-in on return.
 */
export function HubspotCard() {
  const t = useTranslations('settings.hubspot');
  const tActions = useTranslations('readOnly.actions');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage, canAdmin } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const { requiredPlanFor } = useFeatureGate();
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The card as read for a brand: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    value: HubspotRead | null;
  } | null>(null);
  const [reads, setReads] = useState(0);
  // The consent dialog, for the brand it was opened for: a new sign-in (null) or an account to use.
  const [dialog, setDialog] = useState<{ brandId: string; accountId: string | null } | null>(null);
  const [busy, setBusy] = useState<'connect' | 'consent' | 'setup' | 'disconnect' | null>(null);
  // Bumped to stop a sign-in's checks: a newer one, or the card unmounting.
  const pollGen = useRef(0);
  useEffect(() => {
    const gens = pollGen;
    return () => {
      gens.current++;
    };
  }, []);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    readHubspot(activeBrandId).then((result) => {
      if (cancelled) return;
      setRead({ brandId: activeBrandId, value: result.ok ? result : null });
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads]);

  const fail = useCallback(
    (code: HubspotError) => {
      if (code === 'subscription') openUpgrade(tActions('connectIntegrations'));
      else toast.error(t(`errors.${code}`));
    },
    [openUpgrade, t, tActions],
  );

  /** Checks the sign-in until HubSpot is set up for the brand, or the window closes. */
  const finishSignIn = useCallback(
    async (
      brandId: string,
      accountId: string,
      consent: HubspotConsent,
      { gen, popup, tries }: { gen: number; popup?: Window; tries?: number },
    ) => {
      const deadline = Date.now() + CONNECT_DEADLINE_MS;
      for (let n = 0; Date.now() < deadline && pollGen.current === gen; n++) {
        if (tries !== undefined && n >= tries) break;
        await wait(CONNECT_POLL_MS);
        if (pollGen.current !== gen) return;
        const done = await activateHubspot(brandId, { accountId, consent });
        if (done.ok && done.status === 'connected') {
          popup?.close();
          toast.success(t('connectedToast'));
          reload();
          return;
        }
        if (!done.ok && done.code !== 'failed' && done.code !== 'busy') {
          popup?.close();
          fail(done.code);
          return;
        }
        if (popup?.closed) break;
      }
      if (pollGen.current === gen) toast.error(t('connectUnfinished'));
    },
    [fail, reload, t],
  );

  // A sign-in this tab went to HubSpot for (the popup was blocked): finished on return.
  useEffect(() => {
    if (!activeBrandId) return;
    const pending = takePending(activeBrandId);
    if (!pending) return;
    const gen = ++pollGen.current;
    setBusy('connect');
    void finishSignIn(pending.brandId, pending.accountId, pending.consent, {
      gen,
      tries: RESUME_TRIES,
    }).finally(() => {
      if (pollGen.current === gen) setBusy(null);
    });
  }, [activeBrandId, finishSignIn]);

  const current = read?.brandId === activeBrandId ? read : null;
  const value = current?.value ?? null;
  const connection = value?.connection ?? null;
  const setValue = (next: HubspotRead) =>
    setRead((r) => (r && r.brandId === next.brandId ? { ...r, value: next } : r));
  const brandNames = (ids: string[]) =>
    ids
      .map((id) => brands.find((b) => b.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ');

  const connect = async (consent: HubspotConsent, accountId: string | null) => {
    if (!activeBrandId) return;
    const brandId = activeBrandId;
    const gen = ++pollGen.current;
    setBusy('connect');
    try {
      if (accountId) {
        const used = await chooseHubspotAccount(brandId, { accountId, consent });
        if (!used.ok) return fail(used.code);
        setDialog(null);
        setValue(used);
        toast.success(t('connectedToast'));
        return;
      }
      const started = await startHubspotConnect(brandId, {
        callbackUrl: window.location.href.split('#')[0],
        consent,
      });
      if (!started.ok) return fail(started.code);
      setDialog(null);
      const popup = window.open(started.redirectUrl, 'hubspot-oauth', 'width=560,height=720');
      if (!popup) {
        rememberPending({ brandId, accountId: started.accountId, consent, at: Date.now() });
        window.location.href = started.redirectUrl;
        return;
      }
      await finishSignIn(brandId, started.accountId, consent, { gen, popup });
    } finally {
      if (pollGen.current === gen) setBusy(null);
    }
  };

  const changeConsent = async (next: HubspotConsent) => {
    if (!activeBrandId) return;
    setBusy('consent');
    const result = await saveHubspotConsent(activeBrandId, next);
    setBusy(null);
    if (!result.ok) return fail(result.code);
    setValue(result);
  };

  const retrySetup = async () => {
    if (!activeBrandId) return;
    setBusy('setup');
    const result = await retryHubspotSetup(activeBrandId);
    setBusy(null);
    if (!result.ok) return fail(result.code);
    setValue(result);
  };

  const disconnect = async () => {
    if (!activeBrandId) return;
    setBusy('disconnect');
    const result = await disconnectHubspot(activeBrandId);
    setBusy(null);
    if (!result.ok) return fail(result.code);
    toast.success(t('disconnected'));
    reload();
  };

  const openDialog = guard(
    (accountId: string | null) => activeBrandId && setDialog({ brandId: activeBrandId, accountId }),
    { action: tActions('connectIntegrations') },
  );

  const plan = requiredPlanFor('crm_integrations');
  const paused = Boolean(value && !value.allowed && connection);
  const locked = Boolean(value && !value.allowed && !connection);
  const refused = Boolean(connection && !connection.connected);

  let body: ReactNode = null;
  if (!activeBrandId) {
    body = <p className="text-sm text-muted-foreground">{t('noBrand')}</p>;
  } else if (!current) {
    body = <Skeleton className="h-16 w-full" />;
  } else if (!value) {
    body = (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{t('unavailable')}</span>
        <Button variant="outline" size="sm" onClick={reload}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (!value.configured) {
    body = (
      <p className="text-xs text-muted-foreground">
        {t.rich('notConfigured', {
          code: (chunks) => <code className="rounded bg-muted px-1">{chunks}</code>,
        })}
      </p>
    );
  } else if (locked) {
    body = (
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('lockedTitle', { plan })}</p>
        <p className="text-xs text-muted-foreground">{t('lockedDescription')}</p>
        {canAdmin ? (
          <Link href={CHOOSE_PLAN_HREF} className={buttonVariants({ size: 'sm' })}>
            {t('upgrade')}
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">{t('askAdmin')}</p>
        )}
      </div>
    );
  } else if (!connection) {
    body = canManage ? (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openDialog(null)} disabled={busy !== null}>
            {busy === 'connect' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy === 'connect' ? t('connecting') : t('connect')}
          </Button>
          {value.usable.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{t('or')}</span>
              <UseAccountSelect
                accounts={value.usable}
                brandNames={brandNames}
                onPick={(accountId) => openDialog(accountId)}
              />
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('asksFirst')}</p>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{t('notConnectedMember')}</p>
    );
  } else {
    const consent = connection.consent;
    const setupError = connection.properties.error;
    body = (
      <div className="space-y-4">
        {paused && <Note tone="amber">{t('pausedNote')}</Note>}
        {refused && (
          <div className="space-y-2">
            <Note tone="amber">{t('reconnectNote')}</Note>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => openDialog(null)}>
                {t('connectAgain')}
              </Button>
            )}
          </div>
        )}
        {consent.contacts &&
          !refused &&
          (connection.properties.ready ? (
            <p className="flex items-center gap-1.5 text-xs">
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              {t('propertiesReady')}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Note tone="amber">
                {setupError
                  ? t(
                      `propertiesFailed.${(SETUP_ERRORS as readonly string[]).includes(setupError) ? setupError : 'other'}`,
                    )
                  : t('propertiesNotMade')}
              </Note>
              {canManage && !paused && (
                <Button size="sm" variant="outline" onClick={retrySetup} disabled={busy !== null}>
                  {busy === 'setup' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('retry')}
                </Button>
              )}
            </div>
          ))}
        <ConsentRow
          title={t('contacts.title')}
          description={t('contacts.description')}
          checked={consent.contacts}
          disabled={!canManage || paused || busy !== null}
          onChange={guard(
            (next: boolean) => void changeConsent({ contacts: next, pages: consent.pages }),
            { action: tActions('connectIntegrations') },
          )}
        />
        <ConsentRow
          title={t('pages.title')}
          description={t('pages.description')}
          checked={consent.pages}
          disabled={!canManage || paused || busy !== null}
          onChange={guard(
            (next: boolean) => void changeConsent({ contacts: consent.contacts, pages: next }),
            { action: tActions('connectIntegrations') },
          )}
        />
        {consent.pages && !refused && activeBrandId && (
          <BlogPicker
            brandId={activeBrandId}
            picked={connection.blog}
            canPick={canManage && !paused}
            onSaved={setValue}
            onConnectAgain={() => openDialog(null)}
            onRefusal={fail}
          />
        )}
        {consent.at && (consent.contacts || consent.pages) && (
          <p className="text-xs text-muted-foreground">
            {t(consent.by ? 'allowedBy' : 'allowedOn', {
              name: consent.by ?? '',
              date: formatDate(consent.at),
              what: t(
                consent.contacts && consent.pages
                  ? 'allowedWhat.both'
                  : consent.contacts
                    ? 'allowedWhat.contacts'
                    : 'allowedWhat.pages',
              ),
            })}
          </p>
        )}
      </div>
    );
  }

  const shared = connection ? brandNames(connection.sharedWith) : '';

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{t('title')}</p>
                {value && !value.configured && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('notConfiguredBadge')}
                  </Badge>
                )}
                {(locked || paused) && (
                  <Badge variant="outline" className="gap-1">
                    <Crown aria-hidden className="h-3 w-3" />
                    {plan}
                  </Badge>
                )}
                {connection && value?.configured && !paused && !refused && (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  >
                    {t('connected')}
                  </Badge>
                )}
                {(paused || refused) && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  >
                    {paused ? t('paused') : t('reconnectBadge')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {brand ? t('description', { brand: brand.name }) : t('noBrand')}
              </p>
              {connection?.label && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('account', { label: connection.label })}
                  {shared && ` · ${t('sharedWith', { brands: shared })}`}
                </p>
              )}
            </div>
            {canManage && connection && value?.configured && (
              <div className="flex flex-wrap items-center gap-2">
                {!paused && !refused && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openDialog(null)}
                    disabled={busy !== null}
                  >
                    {t('changeAccount')}
                  </Button>
                )}
                <DisconnectButton
                  brandName={brand?.name ?? ''}
                  shared={shared}
                  sharedCount={connection.sharedWith.length}
                  busy={busy === 'disconnect'}
                  onConfirm={disconnect}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {body}
      {dialog && dialog.brandId === activeBrandId && value && (
        <ConsentDialog
          brandName={brand?.name ?? ''}
          accounts={value.usable}
          brandNames={brandNames}
          initialAccountId={dialog.accountId}
          busy={busy === 'connect'}
          onCancel={() => setDialog(null)}
          onContinue={(consent, accountId) => void connect(consent, accountId)}
        />
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: 'amber'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        tone === 'amber' &&
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function ConsentRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t pt-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <SettingsSwitch checked={checked} label={title} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/**
 * Send to CMS's HubSpot blog (00522): the blog draft posts go to. Admins and
 * managers pick it from the account's blogs; others see the one picked.
 * Without HubSpot's content scope (a sign-in made without it), it asks to
 * connect HubSpot again.
 */
function BlogPicker({
  brandId,
  picked,
  canPick,
  onSaved,
  onConnectAgain,
  onRefusal,
}: {
  brandId: string;
  picked: { id: string; name: string | null } | null;
  canPick: boolean;
  onSaved: (next: HubspotRead) => void;
  onConnectAgain: () => void;
  onRefusal: (code: HubspotError) => void;
}) {
  const t = useTranslations('settings.hubspot.blog');
  const id = useId();
  const [read, setRead] = useState<HubspotBlog[] | HubspotError | null>(null);
  const [choice, setChoice] = useState<string | null>(picked?.id ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canPick) return;
    let cancelled = false;
    listHubspotBlogs(brandId).then((result) => {
      if (!cancelled) setRead(result.ok ? result.blogs : result.code);
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, canPick]);

  if (!canPick) {
    return (
      <p className="text-xs text-muted-foreground">
        {picked ? t('goesTo', { blog: picked.name ?? picked.id }) : t('notPicked')}
      </p>
    );
  }
  if (read === null) return <Skeleton className="h-8 w-64" />;
  if (typeof read === 'string') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Note tone="amber">{read === 'scopes' ? t('scopes') : t('unavailable')}</Note>
        {(read === 'scopes' || read === 'refused') && (
          <Button size="sm" variant="outline" onClick={onConnectAgain}>
            {t('connectAgain')}
          </Button>
        )}
      </div>
    );
  }
  if (read.length === 0) return <p className="text-xs text-muted-foreground">{t('none')}</p>;

  const items = read.map((blog) => ({ value: blog.id, label: blog.name }));
  const save = async () => {
    if (!choice) return;
    setSaving(true);
    const result = await saveHubspotBlog(brandId, choice);
    setSaving(false);
    if (!result.ok) return onRefusal(result.code);
    onSaved(result);
    toast.success(t('saved'));
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('label')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select items={items} value={choice} onValueChange={(v) => setChoice(v ?? null)}>
          <SelectTrigger id={id} className="h-8 w-64 max-w-full text-xs">
            <SelectValue placeholder={t('placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={save} disabled={!choice || choice === picked?.id || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('save')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {picked ? t('goesTo', { blog: picked.name ?? picked.id }) : t('notPicked')}
      </p>
    </div>
  );
}

/** "Use another brand's account": the HubSpot accounts other brands use. */
function UseAccountSelect({
  accounts,
  brandNames,
  onPick,
}: {
  accounts: HubspotAccount[];
  brandNames: (ids: string[]) => string;
  onPick: (accountId: string) => void;
}) {
  const t = useTranslations('settings.hubspot');
  const items = accounts.map((a) => ({
    value: a.accountId,
    label: t('accountUsedBy', { label: a.label ?? t('anAccount'), brands: brandNames(a.brandIds) }),
  }));
  return (
    <Select items={items} value={null} onValueChange={(v) => v && onPick(v)}>
      <SelectTrigger className="h-8 w-72 max-w-full text-xs" aria-label={t('usePlaceholder')}>
        <SelectValue placeholder={t('usePlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NEW_SIGN_IN = '__new__';

/**
 * Before connecting: what Ansvisor may do in the brand's HubSpot. Both
 * writes start unticked; one is needed to go on. With accounts other brands
 * use, it can use one of those instead of a new sign-in.
 */
function ConsentDialog({
  brandName,
  accounts,
  brandNames,
  initialAccountId,
  busy,
  onCancel,
  onContinue,
}: {
  brandName: string;
  accounts: HubspotAccount[];
  brandNames: (ids: string[]) => string;
  initialAccountId: string | null;
  busy: boolean;
  onCancel: () => void;
  onContinue: (consent: HubspotConsent, accountId: string | null) => void;
}) {
  const t = useTranslations('settings.hubspot.consent');
  const tCard = useTranslations('settings.hubspot');
  const [contacts, setContacts] = useState(false);
  const [pages, setPages] = useState(false);
  const [account, setAccount] = useState<string>(initialAccountId ?? NEW_SIGN_IN);
  const contactsId = useId();
  const pagesId = useId();
  const accountId = account === NEW_SIGN_IN ? null : account;
  const items = [
    { value: NEW_SIGN_IN, label: t('newAccount') },
    ...accounts.map((a) => ({
      value: a.accountId,
      label: tCard('accountUsedBy', {
        label: a.label ?? tCard('anAccount'),
        brands: brandNames(a.brandIds),
      }),
    })),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title', { brand: brandName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {accounts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('accountLabel')}</p>
              <Select items={items} value={account} onValueChange={(v) => v && setAccount(v)}>
                <SelectTrigger className="h-8 w-full text-xs" aria-label={t('accountLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ConsentOption
            id={contactsId}
            checked={contacts}
            onChange={setContacts}
            title={t('contactsTitle')}
          >
            <li>{t('contactsNow')}</li>
            <li>{t('contactsThen')}</li>
            <li>{t('contactsRead')}</li>
          </ConsentOption>
          <ConsentOption id={pagesId} checked={pages} onChange={setPages} title={t('pagesTitle')}>
            <li>{t('pagesWhat')}</li>
          </ConsentOption>
          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('never')}
          </p>
          {!contacts && !pages && <p className="text-xs text-muted-foreground">{t('pickOne')}</p>}
        </div>
        <DialogFooter className="items-center">
          {!accountId && <span className="mr-auto text-xs text-muted-foreground">{t('next')}</span>}
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button
            disabled={(!contacts && !pages) || busy}
            onClick={() => onContinue({ contacts, pages }, accountId)}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {accountId ? t('useAccount') : t('continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsentOption({
  id,
  checked,
  onChange,
  title,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3', checked && 'border-foreground/30')}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {title}
        </label>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {children}
        </ul>
      </div>
    </div>
  );
}

function DisconnectButton({
  brandName,
  shared,
  sharedCount,
  busy,
  onConfirm,
}: {
  brandName: string;
  shared: string;
  sharedCount: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('settings.hubspot');
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="gap-2" disabled={busy} />}
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
          <DialogTitle>{t('disconnectTitle', { brand: brandName })}</DialogTitle>
          <DialogDescription>{t('disconnectStops', { brand: brandName })}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('disconnectKeeps')}</p>
        {shared && (
          <p className="text-sm text-muted-foreground">
            {t('disconnectShared', { brands: shared, count: sharedCount })}
          </p>
        )}
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
