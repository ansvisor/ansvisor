'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferencesState,
} from '@/lib/actions/notification-preferences';
import {
  ADMIN_ONLY_KINDS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KIND_SPECS,
  choiceFor,
  type NotificationChoices,
  type NotificationFrequency,
  type NotificationGroup,
  type NotificationKind,
  type NotificationKindSpec,
} from '@/lib/notification-preferences';

/**
 * Settings › Notifications, "Your e-mails" (00554): the e-mails Ansvisor
 * sends the signed-in person and how often, theirs only. Brand e-mails are
 * set for All my brands, or for one brand where it should differ. Until
 * they save, the page shows what their brands' Pulse settings send them
 * today. Scheduled jobs and approvals keep their own settings in Chat: the
 * rows link there. Billing and security e-mails can't be turned off.
 */

const ALL = 'all';

export function YourEmailsCard() {
  const t = useTranslations('settings.yourEmails');
  const tActions = useTranslations('readOnly.actions');
  const { canAdmin } = useUserRole();
  const chatAgentic = useChatAgentic();
  const { guard } = useUpgradeGate();
  const [state, setState] = useState<NotificationPreferencesState | null>(null);
  const [choices, setChoices] = useState<NotificationChoices | null>(null);
  const [scope, setScope] = useState<string>(ALL);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getNotificationPreferences();
      setState(next);
      setChoices(next.choices);
    } catch {
      setFailed(true);
      toast.error(t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const brands = useMemo(() => state?.brands ?? [], [state]);
  const brandId = scope === ALL ? null : scope;
  const brandName = brands.find((b) => b.id === brandId)?.name ?? '';

  function setChoice(spec: NotificationKindSpec, value: NotificationFrequency) {
    setChoices((prev) => {
      if (!prev) return prev;
      if (!spec.brandScoped || brandId === null) {
        return { ...prev, all: { ...prev.all, [spec.kind]: value } };
      }
      return {
        ...prev,
        brands: { ...prev.brands, [brandId]: { ...prev.brands[brandId], [spec.kind]: value } },
      };
    });
  }

  /** The brand's own choice for a kind is dropped: it follows All my brands again. */
  function followAll(kind: NotificationKind) {
    if (!brandId) return;
    setChoices((prev) => {
      if (!prev) return prev;
      const own = { ...prev.brands[brandId] };
      delete own[kind];
      return { ...prev, brands: { ...prev.brands, [brandId]: own } };
    });
  }

  function turnOffAll() {
    setChoices((prev) => {
      if (!prev) return prev;
      const all = { ...prev.all };
      for (const spec of NOTIFICATION_KIND_SPECS) {
        if (spec.options.includes('off')) all[spec.kind] = 'off';
      }
      return { ...prev, all, brands: {} };
    });
    setScope(ALL);
    toast.success(t('turnedOff'));
  }

  async function save() {
    if (!choices || saving) return;
    setSaving(true);
    try {
      await saveNotificationPreferences(choices);
      setState((prev) => (prev ? { ...prev, saved: true, choices } : prev));
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const visible = (spec: NotificationKindSpec) =>
    (canAdmin || !ADMIN_ONLY_KINDS.includes(spec.kind)) && (spec.group !== 'agents' || chatAgentic);

  const scopeItems = [
    { value: ALL, label: t('scopeAll', { count: brands.length }) },
    ...brands.map((b) => ({ value: b.id, label: b.name })),
  ];
  const deliveryItems = [
    { value: 'per_brand', label: t('delivery_per_brand') },
    { value: 'combined', label: t('delivery_combined') },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!choices ? (
          failed ? (
            <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )
        ) : (
          <>
            {!state?.saved && <p className="text-xs text-muted-foreground">{t('carriedOver')}</p>}

            {brands.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span id="your-emails-scope" className="text-muted-foreground">
                  {t('for')}
                </span>
                <Select
                  items={scopeItems}
                  value={scope}
                  onValueChange={(value: string | null) => value && setScope(value)}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-52 max-w-full"
                    aria-labelledby="your-emails-scope"
                  >
                    <SelectValue className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span id="your-emails-delivery" className="text-xs text-muted-foreground">
                  {t('deliveryHint')}
                </span>
                <Select items={deliveryItems} value="per_brand">
                  <SelectTrigger
                    size="sm"
                    className="w-56 max-w-full"
                    aria-labelledby="your-emails-delivery"
                  >
                    <SelectValue className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryItems.map((item) => (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                        disabled={item.value === 'combined'}
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {NOTIFICATION_GROUPS.map((group) => {
              const specs = NOTIFICATION_KIND_SPECS.filter(
                (spec) => spec.group === group && visible(spec),
              );
              const extra = groupLinks(group, chatAgentic, canAdmin);
              if (specs.length === 0 && extra.length === 0) return null;
              return (
                <section key={group} aria-labelledby={`your-emails-${group}`}>
                  <h3
                    id={`your-emails-${group}`}
                    className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t(`groups.${group}`)}
                    {group === 'account' && (
                      <span className="font-medium normal-case tracking-normal">
                        {' · '}
                        {t('admins')}
                      </span>
                    )}
                  </h3>
                  <ul className="divide-y">
                    {specs.map((spec) => (
                      <EmailRow
                        key={spec.kind}
                        name={t(`kinds.${spec.kind}.name`)}
                        description={t(`kinds.${spec.kind}.description`)}
                        comingSoon={spec.comingSoon ? t('comingSoon') : null}
                        note={
                          spec.brandScoped && brandId && choices.brands[brandId]?.[spec.kind] ? (
                            <span>
                              {t('brandOnly', { brand: brandName })} ·{' '}
                              <button
                                type="button"
                                className="underline underline-offset-4"
                                onClick={() => followAll(spec.kind)}
                              >
                                {t('useAll')}
                              </button>
                            </span>
                          ) : spec.kind === 'daily_pulse' &&
                            choiceFor(choices, spec.kind, brandId) === 'notable' ? (
                            t('notableNote')
                          ) : null
                        }
                      >
                        <ChoiceSelect
                          spec={spec}
                          label={t(`kinds.${spec.kind}.name`)}
                          value={choiceFor(choices, spec.kind, spec.brandScoped ? brandId : null)}
                          optionLabel={(value) => t(`options.${spec.labels}.${value}`)}
                          onChange={(value) => setChoice(spec, value)}
                        />
                      </EmailRow>
                    ))}
                    {extra.map((key) => (
                      <EmailRow
                        key={key}
                        name={t(`links.${key}.name`)}
                        description={t(`links.${key}.description`)}
                      >
                        {key === 'billing' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" aria-hidden />
                            {t('links.billing.locked')}
                          </span>
                        ) : (
                          <Link
                            href={
                              key === 'approvals'
                                ? '/dashboard/chat/settings'
                                : '/dashboard/chat/scheduled'
                            }
                            className="text-sm underline underline-offset-4"
                          >
                            {t(`links.${key}.link`)}
                          </Link>
                        )}
                      </EmailRow>
                    ))}
                  </ul>
                </section>
              );
            })}

            <p className="text-xs text-muted-foreground">{t('comingSoonHint')}</p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={guard(() => void save(), { action: tActions('saveNotifications') })}
                disabled={saving}
                className="gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={turnOffAll}
              >
                {t('turnOffAll')}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type LinkRow = 'approvals' | 'scheduled' | 'billing';

/** Rows that aren't a choice here: set elsewhere, or always sent. */
function groupLinks(group: NotificationGroup, chatAgentic: boolean, canAdmin: boolean): LinkRow[] {
  if (group === 'agents' && chatAgentic) return ['approvals', 'scheduled'];
  if (group === 'account' && canAdmin) return ['billing'];
  return [];
}

function EmailRow({
  name,
  description,
  comingSoon = null,
  note = null,
  children,
}: {
  name: string;
  description: string;
  comingSoon?: string | null;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium [overflow-wrap:anywhere]">
          {name}
          {comingSoon && (
            <Badge variant="outline" className="ms-2 align-middle text-muted-foreground">
              {comingSoon}
            </Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="flex sm:justify-end">{children}</div>
    </li>
  );
}

function ChoiceSelect({
  spec,
  label,
  value,
  optionLabel,
  onChange,
}: {
  spec: NotificationKindSpec;
  label: string;
  value: NotificationFrequency;
  optionLabel: (value: NotificationFrequency) => string;
  onChange: (value: NotificationFrequency) => void;
}) {
  const items = spec.options.map((option) => ({ value: option, label: optionLabel(option) }));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next: NotificationFrequency | null) => next && onChange(next)}
    >
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
        <SelectValue className="truncate" />
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
