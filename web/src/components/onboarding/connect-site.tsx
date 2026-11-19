'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CheckAgain,
  SnippetCode,
} from '@/app/[locale]/(dashboard)/dashboard/traffic/_snippet-code';
import type { SnippetCheckStatus } from '@/lib/traffic-snippet-client';

/**
 * "Connect your site", the last, optional screen of setup after purchase
 * (lib/onboarding/connect-site.ts): the brand's first run has started, and
 * the AI Traffic snippet is offered as AI Traffic shows it, with its copy
 * button, the message for the developer, and Check again. Done and Later
 * both go on to the dashboard; the snippet stays first in Today's "Finish
 * setting up" until its first visit.
 */
export function ConnectSite({
  brandId,
  domain,
  snippet,
  leaving,
  onCopy,
  onEmailed,
  onMessageCopied,
  onChecked,
  onDone,
  onLater,
}: {
  brandId: string;
  /** The brand's domain, which Check again reads; none: it says to add one. */
  domain: string | undefined;
  /** The brand's snippet tag (connectSiteSnippet). */
  snippet: string;
  /** Done or Later was pressed: the dashboard is opening. */
  leaving: 'done' | 'later' | null;
  onCopy: () => void;
  /** "Email this to my developer" opened the person's mail app. */
  onEmailed: () => void;
  /** "Copy message" copied the developer's message. */
  onMessageCopied: () => void;
  onChecked: (outcome: SnippetCheckStatus | 'failed') => void;
  onDone: () => void;
  onLater: () => void;
}) {
  const t = useTranslations('onboarding.connectSite');
  const [found, setFound] = useState(false);

  return (
    <div data-slot="connect-site">
      <div className="mb-6">
        <p
          data-slot="tracking-started"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t('trackingStarted')}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="rounded-lg border p-4">
        <SnippetCode
          snippet={snippet}
          domain={domain}
          onCopy={onCopy}
          onEmailed={onEmailed}
          onMessageCopied={onMessageCopied}
        />
        <CheckAgain
          brandId={brandId}
          domain={domain}
          checkedAt={null}
          onFound={() => setFound(true)}
          onChecked={onChecked}
        />
        {found && (
          <p
            data-slot="snippet-found"
            role="status"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
          >
            <Check className="size-3.5 shrink-0" aria-hidden />
            {t('found', { domain: domain ?? '' })}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t('tagManager')}</p>
      </div>

      <div className="mt-6 space-y-2">
        <Button className="w-full" disabled={leaving != null} onClick={onDone}>
          {leaving === 'done' && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t('done')}
        </Button>
        <Button variant="ghost" className="w-full" disabled={leaving != null} onClick={onLater}>
          {leaving === 'later' && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t('later')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('laterNote')}</p>
      </div>
    </div>
  );
}
