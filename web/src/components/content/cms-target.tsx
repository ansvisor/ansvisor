'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import type { CmsTarget } from '@/lib/content/cms-send-client';
import { readWebflow } from '@/lib/webflow-client';
import { readWordPress } from '@/lib/wordpress-client';

/**
 * Where Send to CMS sends (#1331, phase 2): the brand's webhook, its
 * Webflow collection once Settings › Integrations has it ready (connected,
 * a collection with a body field), or its WordPress site once connected
 * (00294; no collection or fields to pick there). The choice, picked or
 * sent to, is remembered per brand, in this browser; the first ready of
 * Webflow and WordPress is the first choice where none is remembered, or
 * the remembered one is no longer connected. One remembered and connected
 * but not ready leaves the webhook, as before: the page never goes to
 * another CMS than the one picked. A brand with one connected but not ready
 * sees it, off, so its pages don't go to the webhook unnoticed. A read that
 * fails (or an API without them)
 * leaves the webhook as it was before: a webhook send doesn't need them,
 * and a person who picked the one that couldn't be read is told so.
 */

/** The targets a brand connects in Settings › Integrations. */
type CmsLocal = Exclude<CmsTarget, 'webhook'>;

const storageKey = (brandId: string) => `aeo:cms-target:${brandId}`;

function remembered(brandId: string): CmsTarget | null {
  try {
    const value = localStorage.getItem(storageKey(brandId));
    return value === 'webhook' || value === 'webflow' || value === 'wordpress' ? value : null;
  } catch {
    return null;
  }
}

function remember(brandId: string, target: CmsTarget) {
  try {
    localStorage.setItem(storageKey(brandId), target);
  } catch {
    // Private mode or blocked storage: the choice just isn't kept.
  }
}

/** The brand's Webflow, as Send to CMS reads it. */
export type CmsWebflow =
  /** Ready: pages go to this collection (its name; empty when it has none). */
  | { ready: true; collection: string }
  /** Connected, but its token refused or no collection picked yet. */
  | { ready: false }
  /** Not connected, not set up on this server, or not read: the webhook only. */
  | null;

/** The brand's WordPress, as Send to CMS reads it. */
export type CmsWordPress =
  /** Ready: pages go to this site as draft posts (its name, else its address). */
  | { ready: true; site: string }
  /** Connected, but its sign-in refused. */
  | { ready: false }
  /** Not connected, not set up on this server, or not read. */
  | null;

function webflowOf(result: Awaited<ReturnType<typeof readWebflow>>): CmsWebflow {
  const connection = result.ok && result.configured ? result.connection : null;
  if (!connection) return null;
  return connection.status === 'connected' && connection.collectionId && connection.fieldMap.body
    ? { ready: true, collection: connection.collectionName ?? '' }
    : { ready: false };
}

function wordpressOf(result: Awaited<ReturnType<typeof readWordPress>>): CmsWordPress {
  const connection = result.ok && result.configured ? result.connection : null;
  if (!connection) return null;
  return connection.status === 'connected'
    ? { ready: true, site: connection.siteName || connection.siteUrl }
    : { ready: false };
}

/**
 * The brand's send target: undefined while its Webflow and WordPress
 * connections are read, then where pages go and how to change it. A failed
 * read leaves that one out; `unchecked` names it when the person picked it
 * before, and the page goes to the webhook, with `retry`.
 */
export function useCmsTarget(brandId: string) {
  const [read, setRead] = useState<{
    key: string;
    webflow: CmsWebflow;
    wordpress: CmsWordPress;
    /** The connections that couldn't be read. */
    failed: CmsLocal[];
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<{ brandId: string; target: CmsTarget } | null>(null);
  const key = `${brandId}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([readWebflow(brandId), readWordPress(brandId)]).then(([webflow, wordpress]) => {
      if (cancelled) return;
      setRead({
        key,
        webflow: webflowOf(webflow),
        wordpress: wordpressOf(wordpress),
        failed: [
          ...(webflow.ok ? [] : ['webflow' as const]),
          ...(wordpress.ok ? [] : ['wordpress' as const]),
        ],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, key]);

  const current = read?.key === key ? read : null;
  const webflow = current ? current.webflow : undefined;
  const wordpress = current ? current.wordpress : undefined;
  const chosen = picked?.brandId === brandId ? picked.target : remembered(brandId);
  // Read again after a failure: the note stays, as trying, until the answer.
  const failed = current ? current.failed : read?.key.startsWith(`${brandId}:`) ? read.failed : [];
  const unchecked = chosen && chosen !== 'webhook' && failed.includes(chosen) ? chosen : null;
  const connectionOf = (to: CmsLocal) => (to === 'webflow' ? webflow : wordpress);
  // The choice stands while it's still connected; ready or not, it's never swapped for the other CMS.
  const kept = chosen && (chosen === 'webhook' || connectionOf(chosen)) ? chosen : null;
  const target: CmsTarget | undefined = !current
    ? undefined
    : unchecked
      ? 'webhook'
      : kept
        ? kept === 'webhook' || connectionOf(kept)?.ready
          ? kept
          : 'webhook'
        : webflow?.ready
          ? 'webflow'
          : wordpress?.ready
            ? 'wordpress'
            : 'webhook';

  return {
    /** The brand's Webflow; undefined while read; null without one, or when it couldn't be read. */
    webflow,
    /** The brand's WordPress, as `webflow`. */
    wordpress,
    target,
    /**
     * The target the person picked before that couldn't be read: the page
     * goes to the webhook meanwhile. Null otherwise.
     */
    unchecked,
    /** Reading again, after a failure. */
    reading: current === null,
    retry: () => setAttempt((n) => n + 1),
    pick: (next: CmsTarget) => {
      setPicked({ brandId, target: next });
      remember(brandId, next);
    },
    /** Pages went there: the brand's choice from now on, as if picked. */
    sent: (to: CmsTarget) => remember(brandId, to),
  };
}

const TARGETS = ['webflow', 'wordpress', 'webhook'] as const;

/**
 * The targets the brand has, when it has Webflow or WordPress: the person
 * picks where pages go. The webhook is always one; a CMS connected but not
 * ready shows, off, with what to do. One tab stop, the picked card; the
 * arrow keys move to the next one and pick it, past one that's off.
 */
export function CmsTargetPicker({
  value,
  webflow,
  wordpress,
  onChange,
  disabled,
}: {
  value: CmsTarget;
  webflow: CmsWebflow | undefined;
  wordpress: CmsWordPress | undefined;
  onChange: (target: CmsTarget) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.send.target');
  const cards = useRef<Partial<Record<CmsTarget, HTMLButtonElement | null>>>({});
  const shown = TARGETS.filter(
    (target) => target === 'webhook' || (target === 'webflow' ? webflow : wordpress),
  );
  const off = (target: CmsTarget) =>
    disabled ||
    (target === 'webflow' && !webflow?.ready) ||
    (target === 'wordpress' && !wordpress?.ready);
  const onKey = (event: KeyboardEvent, i: number) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const)[
      event.key as 'ArrowRight'
    ];
    if (!step) return;
    event.preventDefault();
    // The next card that's on, that way round; none past this one, none picked.
    for (let n = 1; n < shown.length; n++) {
      const next = shown[(((i + step * n) % shown.length) + shown.length) % shown.length];
      if (off(next)) continue;
      onChange(next);
      cards.current[next]?.focus();
      return;
    }
  };
  const hint = (target: (typeof TARGETS)[number]) => {
    if (target === 'webhook') return t('webhook.hint');
    if (target === 'webflow') {
      return webflow?.ready
        ? t('webflow.hint', { collection: webflow.collection || t('webflow.collection') })
        : t('webflow.notReady');
    }
    return wordpress?.ready
      ? t('wordpress.hint', { site: wordpress.site })
      : t('wordpress.notReady');
  };
  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className={cn(
        'grid gap-2',
        shown.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2',
      )}
    >
      {shown.map((target, i) => (
        <button
          key={target}
          ref={(el) => void (cards.current[target] = el)}
          type="button"
          role="radio"
          aria-checked={value === target}
          tabIndex={value === target ? 0 : -1}
          disabled={off(target)}
          onClick={() => onChange(target)}
          onKeyDown={(event) => onKey(event, i)}
          className={cn(
            'min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
            value === target && 'border-foreground ring-1 ring-inset ring-foreground',
          )}
        >
          <span className="block text-sm font-medium">{t(`${target}.title`)}</span>
          <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {hint(target)}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The CMS a person picked before couldn't be checked: the page goes to the
 * webhook.
 */
export function CmsTargetUnchecked({
  target,
  reading,
  onRetry,
  disabled,
}: {
  /** The one that couldn't be read. */
  target: CmsLocal;
  reading: boolean;
  onRetry: () => void;
  /** While sending: the target is fixed until the send is over. */
  disabled?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.send.target');
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground"
    >
      <span className="min-w-0 flex-1">
        {t(target === 'wordpress' ? 'uncheckedWordPress' : 'unchecked')}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={reading || disabled}
        aria-label={t('retry')}
        onClick={onRetry}
      >
        {reading ? <LoadingDots /> : t('retry')}
      </Button>
    </div>
  );
}
