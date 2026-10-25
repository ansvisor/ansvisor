'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import type { CmsTarget } from '@/lib/content/cms-send-client';
import { readWebflow } from '@/lib/webflow-client';

/**
 * Where Send to CMS sends (#1331, phase 2): the brand's webhook, or its
 * Webflow collection once Settings › Integrations has it ready (connected,
 * a collection with a body field). The choice is remembered per brand, in
 * this browser; Webflow is the first choice where it's ready. A brand with
 * Webflow connected but not ready sees it, off, so its pages don't go to
 * the webhook unnoticed. A read that fails (or an API without Webflow)
 * leaves the webhook as it was before Webflow: a webhook send doesn't need
 * Webflow, and a person who picked Webflow before is told it couldn't be
 * checked.
 */

const storageKey = (brandId: string) => `aeo:cms-target:${brandId}`;

function remembered(brandId: string): CmsTarget | null {
  try {
    const value = localStorage.getItem(storageKey(brandId));
    return value === 'webhook' || value === 'webflow' ? value : null;
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

/**
 * The brand's send target: undefined while its Webflow connection is read,
 * then where pages go and how to change it. A failed read is the webhook;
 * `unchecked` says so when the person picked Webflow before, with `retry`.
 */
export function useCmsTarget(brandId: string) {
  const [read, setRead] = useState<{
    key: string;
    webflow: CmsWebflow;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<{ brandId: string; target: CmsTarget } | null>(null);
  const key = `${brandId}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    readWebflow(brandId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setRead({ key, webflow: null, failed: true });
        return;
      }
      const connection = result.configured ? result.connection : null;
      const webflow: CmsWebflow = !connection
        ? null
        : connection.status === 'connected' && connection.collectionId && connection.fieldMap.body
          ? { ready: true, collection: connection.collectionName ?? '' }
          : { ready: false };
      setRead({ key, webflow, failed: false });
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, key]);

  const current = read?.key === key ? read : null;
  const webflow = current ? current.webflow : undefined;
  const chosen = picked?.brandId === brandId ? picked.target : remembered(brandId);
  const target: CmsTarget | undefined =
    webflow === undefined ? undefined : webflow?.ready ? (chosen ?? 'webflow') : 'webhook';
  // Read again after a failure: the note stays, as trying, until the answer.
  const failed = current
    ? current.failed
    : (read?.failed ?? false) && read?.key.startsWith(`${brandId}:`) === true;

  return {
    /** The brand's Webflow; undefined while read; null without one, or when it couldn't be read. */
    webflow,
    target,
    /** Couldn't be read, for a person who picked Webflow before: the page goes to the webhook. */
    unchecked: failed && chosen === 'webflow',
    /** Reading again, after a failure. */
    reading: current === null,
    retry: () => setAttempt((n) => n + 1),
    pick: (next: CmsTarget) => {
      setPicked({ brandId, target: next });
      remember(brandId, next);
    },
  };
}

const TARGETS = ['webflow', 'webhook'] as const;

/**
 * The two targets, when the brand has Webflow: the person picks where pages
 * go. Webflow connected but not ready shows, off, with what to do. One tab
 * stop, the picked card; the arrow keys move to the other and pick it,
 * past Webflow while it's off.
 */
export function CmsTargetPicker({
  value,
  webflow,
  onChange,
  disabled,
}: {
  value: CmsTarget;
  webflow: NonNullable<CmsWebflow>;
  onChange: (target: CmsTarget) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.send.target');
  const cards = useRef<Partial<Record<CmsTarget, HTMLButtonElement | null>>>({});
  const off = (target: CmsTarget) => disabled || (target === 'webflow' && !webflow.ready);
  const onKey = (event: KeyboardEvent, i: number) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const)[
      event.key as 'ArrowRight'
    ];
    if (!step) return;
    event.preventDefault();
    const next = TARGETS[(i + step + TARGETS.length) % TARGETS.length];
    if (off(next)) return;
    onChange(next);
    cards.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t('label')} className="grid grid-cols-2 gap-2">
      {TARGETS.map((target, i) => (
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
            {target === 'webhook'
              ? t('webhook.hint')
              : webflow.ready
                ? t('webflow.hint', { collection: webflow.collection || t('webflow.collection') })
                : t('webflow.notReady')}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Webflow couldn't be checked for a person who picked it before: the page goes to the webhook. */
export function CmsTargetUnchecked({
  reading,
  onRetry,
}: {
  reading: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('contentEditor.editor.send.target');
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground"
    >
      <span className="min-w-0 flex-1">{t('unchecked')}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={reading}
        aria-label={t('retry')}
        onClick={onRetry}
      >
        {reading ? <LoadingDots /> : t('retry')}
      </Button>
    </div>
  );
}
