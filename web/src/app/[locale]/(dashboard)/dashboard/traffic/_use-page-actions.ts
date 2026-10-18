'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { getAuditQuota, runAuditsBulk, type AuditQuota } from '@/lib/actions/audits';
import {
  sendTrafficPagesToActionCenter,
  type TrafficDateWindow,
  type TrafficPagesReason,
} from '@/lib/actions/traffic';

/** The most pages one action, or one bulk audit, takes. */
export const PAGE_ACTION_MAX = 50;

/**
 * The Pages section's actions (AT-006 part B), shared by its rows and its
 * footer: send pages to the Action Center as one action, and audit several
 * pages at once within the month's audits. Each reports how it went in a
 * toast that opens what it made.
 */
export function usePageActions(brandId: string, dateWindow: TrafficDateWindow) {
  const t = useTranslations('traffic.pageList.actions');
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [auditing, setAuditing] = useState(false);
  // The organization's audits this month, for the bulk audit's limit.
  const [quota, setQuota] = useState<AuditQuota | null>(null);

  const loadQuota = useCallback(() => {
    getAuditQuota()
      .then(setQuota)
      // Unknown: the server still refuses audits over the limit.
      .catch(() => setQuota(null));
  }, []);
  useEffect(loadQuota, [loadQuota]);

  const send = useCallback(
    async (pages: string[], reason: TrafficPagesReason): Promise<boolean> => {
      const sent = pages.slice(0, PAGE_ACTION_MAX);
      if (sent.length === 0) return false;
      setSending(true);
      const toastId = toast.loading(t('sending'));
      try {
        const result = await sendTrafficPagesToActionCenter(brandId, dateWindow, sent, reason);
        if ('error' in result) {
          toast.error(t('sendFailed'), { id: toastId, description: result.error });
          return false;
        }
        const open = {
          label: t('open'),
          onClick: () => router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
        };
        if (result.created) {
          toast.success(t('sent'), {
            id: toastId,
            description: t('sentDescription', { number: result.actionNo, count: sent.length }),
            duration: 10_000,
            action: open,
          });
        } else {
          toast.info(t('alreadySent'), {
            id: toastId,
            description: t('alreadySentDescription', { number: result.actionNo }),
            duration: 10_000,
            action: open,
          });
        }
        return true;
      } catch {
        toast.error(t('sendFailed'), { id: toastId });
        return false;
      } finally {
        setSending(false);
      }
    },
    [brandId, dateWindow, router, t],
  );

  const auditMany = useCallback(
    async (urls: string[]): Promise<boolean> => {
      if (urls.length === 0) return false;
      setAuditing(true);
      const toastId = toast.loading(t('auditing'));
      try {
        const { started } = await runAuditsBulk(brandId, urls.slice(0, PAGE_ACTION_MAX));
        toast.success(t('auditsStarted', { count: started }), {
          id: toastId,
          description: t('auditsStartedDescription'),
          duration: 10_000,
          action: { label: t('openAudit'), onClick: () => router.push('/dashboard/audit') },
        });
        return true;
      } catch (err) {
        toast.error(t('auditsFailed'), {
          id: toastId,
          description: err instanceof Error ? err.message : undefined,
        });
        return false;
      } finally {
        setAuditing(false);
        loadQuota();
      }
    },
    [brandId, loadQuota, router, t],
  );

  return { send, sending, auditMany, auditing, quota };
}

/**
 * Why a bulk audit of `count` pages can't start, or null when it can: the
 * month's audits are spent, or fewer are left than pages (the server starts
 * all of them or none). An unknown or unlimited quota never blocks.
 */
export function auditBlock(
  quota: AuditQuota | null,
  count: number,
): { reason: 'noneLeft' } | { reason: 'overQuota'; remaining: number } | null {
  if (!quota || quota.limit === -1) return null;
  const remaining = Math.max(0, quota.remaining);
  if (remaining === 0) return { reason: 'noneLeft' };
  if (count > remaining) return { reason: 'overQuota', remaining };
  return null;
}
