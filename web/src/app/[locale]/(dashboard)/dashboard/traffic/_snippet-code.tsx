'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Code, Copy, Loader2, Mail, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPublicApiBaseUrl } from '@/config/api';
import { track } from '@/lib/analytics';
import { trackingSnippetTag, type ConversionsConsent } from '@/lib/conversion-tracking';
import { formatRelative } from '@/lib/format-relative';
import { cn } from '@/lib/utils';
import { checkTrackingSnippet, type SnippetCheckStatus } from '@/lib/traffic-snippet-client';
import { snippetMailto, snippetMessage } from '@/lib/traffic-snippet-message';

/**
 * The tracking snippet tag for a brand, with conversions when it has them on
 * (CE-017), or null without a code or an API URL.
 */
function snippetTag(trackingCode?: string, conversions?: ConversionsConsent | null): string | null {
  return trackingSnippetTag(getPublicApiBaseUrl(), trackingCode, conversions ?? null);
}

/**
 * Where the tag goes, the tag, and a copy button. The tag wraps inside its
 * box, and the block can shrink below the tag's width: in the dialog's grid
 * it would otherwise widen the dialog past the screen. Onboarding's "Connect
 * your site" shows it too, and counts the copies (`onCopy`). Under the tag,
 * the message for the developer who edits the site (DeveloperMessage).
 */
export function SnippetCode({
  snippet,
  domain,
  onCopy,
  onEmailed,
  onMessageCopied,
}: {
  snippet: string;
  /** The brand's domain, which the message names; none: "our website". */
  domain?: string;
  onCopy?: () => void;
} & SnippetMessageEvents) {
  const t = useTranslations('traffic');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {t.rich('snippetDescription', {
            tag: '</head>',
            code: (chunks) => <code className="text-[11px]">{chunks}</code>,
          })}
        </p>
        <pre className="mt-2 rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px] break-all whitespace-pre-wrap">
          {snippet}
        </pre>
        <DeveloperMessage
          snippet={snippet}
          domain={domain}
          onEmailed={onEmailed}
          onMessageCopied={onMessageCopied}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleCopy}
        aria-label={t('copySnippet')}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

/** The message's analytics: onboarding's own events, or AI Traffic's (trafficMessageEvents). */
interface SnippetMessageEvents {
  /** "Email this to my developer" opened the person's mail app. */
  onEmailed?: () => void;
  /** "Copy message" copied the message. */
  onMessageCopied?: () => void;
}

/** AI Traffic's Install (the banner and the dialog) counts the message as its own. */
const trafficMessageEvents: Required<SnippetMessageEvents> = {
  onEmailed: () => track('traffic_snippet_emailed'),
  onMessageCopied: () => track('traffic_snippet_message_copied'),
};

/**
 * "Email this to my developer" and "Copy message" (traffic-snippet-message.ts):
 * most owners don't edit their site's code. The link opens the person's own
 * mail app with the tag and the steps, no recipient; nothing is sent from
 * here. Copy gives the same text, for someone without a mail app.
 */
function DeveloperMessage({
  snippet,
  domain,
  onEmailed,
  onMessageCopied,
}: { snippet: string; domain?: string } & SnippetMessageEvents) {
  const t = useTranslations('traffic.snippetMessage');
  const [copied, setCopied] = useState(false);
  const message = snippetMessage((key, values) => t(key, values), snippet, domain);
  const mailto = snippetMailto(message);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.body);
    setCopied(true);
    onMessageCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-slot="snippet-message" className="mt-2 flex flex-wrap items-center gap-2">
      {mailto && (
        <a
          href={mailto}
          onClick={() => onEmailed?.()}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1.5 text-xs')}
        >
          <Mail className="h-3 w-3" aria-hidden />
          {t('email')}
        </a>
      )}
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
        {copied ? (
          <Check className="h-3 w-3 text-green-500" aria-hidden />
        ) : (
          <Copy className="h-3 w-3" aria-hidden />
        )}
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}

/** What the brand's home page check says: where the snippet goes, and Check again (00433). */
export interface SnippetCheckProps {
  brandId: string;
  /** The brand's primary domain; without one there is nothing to check. */
  domain: string | undefined;
  /** When the home page was last checked, or null. */
  checkedAt: string | null;
  /** The page's own first check is running: Check again waits for it. */
  busy?: boolean;
  /** The check found it: the page reads its sources again. */
  onFound: () => void;
  /** Each check's outcome, for analytics (onboarding's "Connect your site"). */
  onChecked?: (outcome: SnippetCheckStatus | 'failed') => void;
}

/**
 * Check again: the server reads the brand's home page for the snippet. A
 * find reloads the page's sources (the banner goes); otherwise the line
 * says what it saw, or that the domain is missing or didn't answer.
 * Onboarding's "Connect your site" offers it too.
 */
export function CheckAgain({
  brandId,
  domain,
  checkedAt,
  busy = false,
  onFound,
  onChecked,
}: SnippetCheckProps) {
  const t = useTranslations('traffic.snippetCheck');
  const tCommon = useTranslations('common');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<SnippetCheckStatus, 'found'> | 'failed' | null>(
    null,
  );
  // This check's time, else the page's read: a first check that ran shows too.
  const [checkedHere, setCheckedHere] = useState<string | null>(null);
  const lastChecked = checkedHere ?? checkedAt;
  const running = checking || busy;

  const run = async () => {
    setChecking(true);
    const result = await checkTrackingSnippet(brandId);
    setChecking(false);
    onChecked?.(result.ok ? result.status : 'failed');
    if (!result.ok) return setOutcome('failed');
    if (result.checkedAt) setCheckedHere(result.checkedAt);
    if (result.status === 'found') {
      setOutcome(null);
      return onFound();
    }
    setOutcome(result.status);
  };

  const line =
    outcome === 'not_found'
      ? t('notFound', { domain: domain ?? '' })
      : outcome === 'unreachable'
        ? t('unreachable', { domain: domain ?? '' })
        : outcome === 'no_domain'
          ? t('noDomain')
          : outcome === 'failed'
            ? t('failed')
            : lastChecked
              ? t('lastChecked', { when: formatRelative(lastChecked, tCommon) })
              : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        disabled={running || !domain}
        onClick={() => void run()}
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {running ? t('checking') : t('checkAgain')}
      </Button>
      {(line || !domain) && (
        <p className="text-xs text-muted-foreground" role="status">
          {domain ? line : t('noDomain')}
        </p>
      )}
    </div>
  );
}

/**
 * The snippet's code, open on the page: only while the snippet isn't seen
 * on the site (AT-001, 00433). Once it is, the code sits behind the
 * sources strip's Code button instead of staying at the top for good. With
 * `check`, it says the code wasn't found on the brand's domain, how to add
 * it, and offers Check again.
 */
export function SnippetBanner({
  trackingCode,
  conversions,
  check,
}: {
  trackingCode?: string;
  /** The brand's consent mode when it has conversions on, else null. */
  conversions?: ConversionsConsent | null;
  /** Not detected on the site: the steps and Check again; absent when the state couldn't be read. */
  check?: SnippetCheckProps;
}) {
  const t = useTranslations('traffic');
  const snippet = snippetTag(trackingCode, conversions);
  if (!snippet) return null;

  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardContent className="flex items-start gap-3 px-4 py-3">
        <Code className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-sm font-medium">
            {!check
              ? t('snippetTitle')
              : check.domain
                ? t('snippetCheck.title', { domain: check.domain })
                : t('snippetCheck.titleNoDomain')}
          </p>
          {check && (
            <ol className="mb-2 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
              <li>{t('snippetCheck.stepCopy')}</li>
              <li>
                {t.rich('snippetCheck.stepPaste', {
                  tag: '</head>',
                  code: (chunks) => <code className="text-[11px]">{chunks}</code>,
                })}
              </li>
              <li>{t('snippetCheck.stepCheck')}</li>
            </ol>
          )}
          <SnippetCode snippet={snippet} domain={check?.domain} {...trafficMessageEvents} />
          {check && (
            <>
              <CheckAgain {...check} />
              <p className="mt-1 text-xs text-muted-foreground">{t('snippetCheck.tagManager')}</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The snippet's code in a dialog, from the sources strip's Code or Install button. */
export function SnippetDialog({
  trackingCode,
  conversions,
  domain,
  open,
  onOpenChange,
}: {
  trackingCode?: string;
  /** The brand's consent mode when it has conversions on, else null. */
  conversions?: ConversionsConsent | null;
  /** The brand's primary domain, which the developer's message names. */
  domain?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('traffic');
  const snippet = snippetTag(trackingCode, conversions);
  if (!snippet) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('snippetTitle')}</DialogTitle>
        </DialogHeader>
        <SnippetCode snippet={snippet} domain={domain} {...trafficMessageEvents} />
      </DialogContent>
    </Dialog>
  );
}
