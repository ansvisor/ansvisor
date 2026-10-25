'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { CmsTarget } from '@/lib/content/cms-send-client';
import { readWebflow } from '@/lib/webflow-client';

/**
 * Where Send to CMS sends (#1331, phase 2): the brand's webhook, or its
 * Webflow collection once Settings › Integrations has it ready (connected,
 * a collection with a body field). The choice is remembered per brand, in
 * this browser; Webflow is the first choice where it's ready.
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

/**
 * The brand's send target: undefined while its Webflow connection is read,
 * then the Webflow collection pages go to (null when Webflow isn't ready),
 * the target picked and how to change it.
 */
export function useCmsTarget(brandId: string) {
  const [read, setRead] = useState<{ brandId: string; collection: string | null } | null>(null);
  const [picked, setPicked] = useState<{ brandId: string; target: CmsTarget } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readWebflow(brandId).then((result) => {
      if (cancelled) return;
      const connection = result.ok && result.configured ? result.connection : null;
      const ready =
        connection?.status === 'connected' &&
        Boolean(connection.collectionId) &&
        Boolean(connection.fieldMap.body);
      setRead({ brandId, collection: ready ? (connection?.collectionName ?? '') : null });
    });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const current = read?.brandId === brandId ? read : null;
  const webflow = current ? current.collection : undefined;
  const chosen = picked?.brandId === brandId ? picked.target : remembered(brandId);
  const target: CmsTarget | undefined =
    webflow === undefined ? undefined : webflow === null ? 'webhook' : (chosen ?? 'webflow');

  return {
    /** The Webflow collection's name when Webflow is ready; null when not; undefined while read. */
    webflow,
    target,
    pick: (next: CmsTarget) => {
      setPicked({ brandId, target: next });
      remember(brandId, next);
    },
  };
}

/** The two targets, when Webflow is ready: the person picks where pages go. */
export function CmsTargetPicker({
  value,
  collection,
  onChange,
  disabled,
}: {
  value: CmsTarget;
  /** The Webflow collection pages go to. */
  collection: string;
  onChange: (target: CmsTarget) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('contentEditor.editor.send.target');
  return (
    <div role="radiogroup" aria-label={t('label')} className="grid grid-cols-2 gap-2">
      {(['webflow', 'webhook'] as const).map((target) => (
        <button
          key={target}
          type="button"
          role="radio"
          aria-checked={value === target}
          disabled={disabled}
          onClick={() => onChange(target)}
          className={cn(
            'min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60',
            value === target && 'border-foreground ring-1 ring-inset ring-foreground',
          )}
        >
          <span className="block text-sm font-medium">{t(`${target}.title`)}</span>
          <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {target === 'webflow' ? t('webflow.hint', { collection }) : t('webhook.hint')}
          </span>
        </button>
      ))}
    </div>
  );
}
