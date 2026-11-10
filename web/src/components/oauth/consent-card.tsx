import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeftRight, Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { AuthCard } from '@/components/auth/auth-shell';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ConsentErrorCode } from '@/lib/mcp-oauth/authorize';
import type { ConsentApp, ConsentView } from '@/lib/mcp-oauth/consent';
import { cn } from '@/lib/utils';

/**
 * The consent page's cards (MCP over OAuth, #2141; the approved mockup's
 * screens 2 to 6): connect an app, the plan blocks, the workspace not set
 * up, and a request that can't be used. Plain forms posting to server
 * actions: they work before any script loads. Cancel and "Back to …" tell
 * the app no; Allow sends it a one-time code.
 */

type FormAction = string | ((formData: FormData) => void | Promise<void>);

export interface ConsentActions {
  approve: FormAction;
  deny: FormAction;
  switchAccount: FormAction;
}

const BILLING = '/dashboard/settings/billing';

/** AuthCard's frame, with the page's own heading. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-card p-6 shadow-[0_12px_40px_rgba(60,45,30,0.06)] sm:p-8 dark:border-border dark:shadow-none">
      {children}
    </div>
  );
}

function AppTiles({ app }: { app: ConsentApp }) {
  const letter = (app.name?.trim()[0] ?? '?').toUpperCase();
  return (
    <div className="mb-6 flex items-center justify-center gap-3" aria-hidden>
      <span
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold',
          app.recognised
            ? 'bg-[#efe9df] text-[#3d2f22]'
            : 'border border-dashed border-border bg-muted text-muted-foreground',
        )}
      >
        {letter}
      </span>
      <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#efe9df]">
        <Image src="/logo_light.svg" alt="" width={34} height={34} className="h-8 w-8" />
      </span>
    </div>
  );
}

function useAppName(app: ConsentApp) {
  const t = useTranslations('oauthConsent');
  return app.name ?? t('theApp');
}

function ReturnLine({ app }: { app: ConsentApp }) {
  const t = useTranslations('oauthConsent');
  return (
    <p className="mt-1 text-center text-sm text-muted-foreground">
      {t.rich(app.loopback ? 'backToComputer' : 'backTo', {
        host: app.host,
        b: (chunks) => <b className="font-semibold text-foreground">{chunks}</b>,
      })}
    </p>
  );
}

function Pill({ recognised }: { recognised: boolean }) {
  const t = useTranslations('oauthConsent');
  return (
    <div className="mt-3 flex justify-center">
      <span
        data-slot={recognised ? 'recognised' : 'unchecked'}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
          recognised
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
        )}
      >
        {recognised ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {recognised ? t('recognised') : t('unchecked')}
      </span>
    </div>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'mt-5 rounded-lg border p-3 text-sm',
        tone === 'warn'
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300',
      )}
    >
      {children}
    </div>
  );
}

function Title({ app }: { app: ConsentApp }) {
  const t = useTranslations('oauthConsent');
  if (app.recognised) return <>{t('title', { app: app.name ?? '' })}</>;
  if (app.name) return <>{t('titleUnchecked', { app: app.name })}</>;
  return <>{t('titleNoName')}</>;
}

/** Connect: who, which workspace and brands, and what the app may do. */
function ConnectCard({ view, actions }: { view: ConsentView; actions: ConsentActions }) {
  const t = useTranslations('oauthConsent');
  const app = view.app;
  const name = useAppName(app);
  // mcp:write (lib/mcp-oauth/scopes.ts), named here so the card imports no server module.
  const asksWrite = view.scopes.includes('mcp:write');
  const role = t(`role.${view.role ?? 'none'}`);

  return (
    <Panel>
      <AppTiles app={app} />
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        <Title app={app} />
      </h1>
      <Pill recognised={app.recognised} />
      <ReturnLine app={app} />

      {!app.recognised && (
        <Note tone="warn">
          <p className="font-semibold">{t('uncheckedWarningTitle')}</p>
          <p className="mt-1">
            {app.name ? t('uncheckedWarningName', { app: app.name }) : t('uncheckedWarningNoName')}
            {app.loopback && <> {t('uncheckedWarningComputer')}</>}
          </p>
        </Note>
      )}

      <dl className="mt-5 divide-y rounded-xl border text-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <dt className="w-24 shrink-0 text-xs text-muted-foreground">{t('account')}</dt>
          <dd className="min-w-0 flex-1 break-words">
            {view.email} · {role}
          </dd>
          <form action={actions.switchAccount}>
            <input type="hidden" name="request" value={view.requestId} />
            <button type="submit" className="text-xs underline-offset-2 hover:underline">
              {t('switchAccount')}
            </button>
          </form>
        </div>
        {view.workspace && (
          <div className="flex items-center gap-3 px-4 py-3">
            <dt className="w-24 shrink-0 text-xs text-muted-foreground">{t('workspace')}</dt>
            <dd className="min-w-0 flex-1">
              {view.workspace.name}
              <span className="block text-xs text-muted-foreground">
                {t('plan', { plan: view.workspace.planName })}
              </span>
            </dd>
          </div>
        )}
        {view.brands && (
          <div className="flex items-center gap-3 px-4 py-3">
            <dt className="w-24 shrink-0 text-xs text-muted-foreground">{t('brands')}</dt>
            <dd className="min-w-0 flex-1">
              {view.brands.all
                ? t('brandsAll', { count: view.brands.count })
                : t('brandsSelected', { count: view.brands.names.length })}
              <span className="block text-xs text-muted-foreground">
                {!view.brands.all && view.brands.names.length > 0
                  ? view.brands.names.join(', ')
                  : t('brandsNote', { app: name })}
              </span>
            </dd>
          </div>
        )}
      </dl>

      <form action={actions.approve}>
        <input type="hidden" name="request" value={view.requestId} />
        <p className="mt-5 mb-2 text-sm font-semibold">{t('willBeAbleTo', { app: name })}</p>
        <div className="space-y-2">
          <label className="flex gap-3 rounded-xl border p-3">
            <input type="checkbox" checked disabled readOnly className="mt-0.5 h-4 w-4" />
            <span>
              <span className="block text-sm font-medium">{t('readTitle')}</span>
              <span className="block text-xs text-muted-foreground">{t('readBody')}</span>
            </span>
          </label>
          {asksWrite && (
            <label className="flex cursor-pointer gap-3 rounded-xl border p-3">
              <input
                type="checkbox"
                name="allow_changes"
                defaultChecked
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{t('writeTitle')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('writeBody', { app: name })}
                </span>
                {view.writesNeedGrowth && view.workspace && (
                  <span
                    data-slot="write-plan-note"
                    className="mt-1 block text-xs text-amber-800 dark:text-amber-300"
                  >
                    {t('writePlanNote', { plan: view.workspace.planName })}
                  </span>
                )}
              </span>
            </label>
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{t('fine')}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            formAction={actions.deny}
            className={buttonVariants({ variant: 'outline', className: 'h-10 flex-1' })}
          >
            {t('cancel')}
          </button>
          <button type="submit" className={buttonVariants({ className: 'h-10 flex-1' })}>
            {t('allow')}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** The plan or the workspace stops the connection: why, and the way back to the app. */
function BlockedCard({ view, actions }: { view: ConsentView; actions: ConsentActions }) {
  const t = useTranslations('oauthConsent');
  const name = useAppName(view.app);
  const access = view.access;
  const title =
    access === 'trial'
      ? t('trialTitle')
      : access === 'ended'
        ? t('endedTitle')
        : t('noWorkspaceTitle');
  const body =
    access === 'trial'
      ? t('trialBody', { app: name })
      : access === 'ended'
        ? t('endedBody', { app: name })
        : t('noWorkspaceBody');
  const choosePlan = view.isAdmin && (access === 'trial' || access === 'ended');

  return (
    <Panel>
      <AppTiles app={view.app} />
      <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-center text-muted-foreground">{body}</p>
      {access !== 'no_workspace' && (
        <Note tone="info">
          {access === 'trial'
            ? t('trialKeyNote')
            : view.isAdmin
              ? t('endedAdmin')
              : t('askAdmin', { workspace: view.workspace?.name ?? '' })}
        </Note>
      )}
      <form action={actions.deny} className="mt-6 flex gap-3">
        <input type="hidden" name="request" value={view.requestId} />
        <button
          type="submit"
          className={buttonVariants({ variant: 'outline', className: 'h-10 flex-1' })}
        >
          {t('backToApp', { app: name })}
        </button>
        {choosePlan && (
          <Link href={BILLING} className={buttonVariants({ className: 'h-10 flex-1' })}>
            {t('choosePlan')}
          </Link>
        )}
        {access === 'no_workspace' && (
          <Link href="/dashboard" className={buttonVariants({ className: 'h-10 flex-1' })}>
            {t('openAnsvisor')}
          </Link>
        )}
      </form>
    </Panel>
  );
}

export function ConsentCard({ view, actions }: { view: ConsentView; actions: ConsentActions }) {
  return view.access === 'ok' ? (
    <ConnectCard view={view} actions={actions} />
  ) : (
    <BlockedCard view={view} actions={actions} />
  );
}

/** A request that can't be used: said plainly, and never sent anywhere. */
export function ConsentErrorCard({ code }: { code: ConsentErrorCode }) {
  const t = useTranslations('oauthConsent');
  return (
    <AuthCard title={t('errorTitle')}>
      <p className="text-center text-muted-foreground">{t(`errors.${code}`)}</p>
      <p className="mt-3 text-center text-sm text-muted-foreground">{t('errorRetry')}</p>
      <p className="mt-4 text-center text-xs text-muted-foreground">{t('errorCode', { code })}</p>
      <Link href="/dashboard" className={buttonVariants({ className: 'mt-6 h-10 w-full' })}>
        {t('openAnsvisor')}
      </Link>
    </AuthCard>
  );
}
