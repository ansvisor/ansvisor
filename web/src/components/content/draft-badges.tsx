'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DraftMethod, DraftStatus } from '@/lib/content/drafts';

/**
 * A draft's status and method, as the Library and the editor show them
 * (Content Editor spec: Draft grey, In review amber, Ready green, Published
 * blue; Create blue, Optimize amber). Colors as Action Center's badges.
 */

export const DRAFT_STATUS_BADGE: Record<DraftStatus, string> = {
  draft: 'border-border bg-muted/50 text-muted-foreground',
  in_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ready: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  published: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

export const DRAFT_METHOD_BADGE: Record<DraftMethod, string> = {
  create: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  optimize: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  const t = useTranslations('contentEditor.status');
  return (
    <Badge variant="outline" className={DRAFT_STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(status)}
    </Badge>
  );
}

export function DraftMethodBadge({
  method,
  className,
}: {
  method: DraftMethod;
  className?: string;
}) {
  const t = useTranslations('contentEditor.method');
  return (
    <Badge variant="outline" className={cn(DRAFT_METHOD_BADGE[method], className)}>
      {t(method)}
    </Badge>
  );
}
