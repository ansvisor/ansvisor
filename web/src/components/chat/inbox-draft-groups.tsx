'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  approveGroup,
  listDraftApprovalGroups,
  type ApproveFailure,
} from '@/lib/actions/chat-approve-all';
import type { ApprovalGroup } from '@/lib/chat/pending-approvals';

/** What Approve all did for a draft: how many went on, and the items that didn't. */
interface Outcome {
  key: string;
  title: string;
  started: number;
  failed: ApproveFailure[];
}

/**
 * Drafts that several of the person's runs wait on, each with one Approve
 * all (Needs you): "N changes from M agents", each agent's change, and the
 * button. Each run is still approved from its own chat. Approve all starts
 * every run in the background and lists the ones that couldn't be approved.
 */
export function InboxDraftGroups({ brandId }: { brandId: string | null | undefined }) {
  const t = useTranslations('chatShell.inbox.drafts');
  const [groups, setGroups] = useState<ApprovalGroup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return setGroups([]);
    try {
      const read = await listDraftApprovalGroups(brandId);
      if (read.ok) setGroups(read.groups);
    } catch {
      // The groups are a shortcut: each run's own card is still in its chat.
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (group: ApprovalGroup) => {
    if (!brandId) return;
    setBusy(group.key);
    setProblem(null);
    try {
      const result = await approveGroup(brandId, group.key, group.version);
      if (result.ok) {
        setOutcomes((all) => [
          ...all,
          { key: group.key, title: group.title, started: result.started, failed: result.failed },
        ]);
      } else {
        setProblem(
          t(
            result.reason === 'changed'
              ? 'changed'
              : result.reason === 'not_found'
                ? 'notFound'
                : result.reason === 'read_only'
                  ? 'readOnly'
                  : 'signedOut',
          ),
        );
      }
      await load();
    } catch {
      setProblem(t('failed'));
    } finally {
      setBusy(null);
    }
  };

  if (groups.length + outcomes.length === 0 && !problem) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="inbox-draft-groups">
      {problem && (
        <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      {groups.map((group) => (
        <div
          key={group.key}
          data-action="inbox.draftGroup"
          className="rounded-[14px] border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/20"
        >
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              <span className="font-semibold">{group.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t('summary', { changes: group.items.length, agents: group.agents })}
              </span>
            </span>
            <Button
              size="sm"
              data-action="inbox.approveAll"
              disabled={busy !== null}
              onClick={() => void approve(group)}
            >
              {t(busy === group.key ? 'approving' : 'approveAll')}
            </Button>
          </div>
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {group.items.map((item, i) => (
              <li key={i}>
                {item.agent} · {item.summary}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {outcomes.map((outcome) => (
        <div key={outcome.key} role="status" className="rounded-[14px] border p-3 text-xs">
          {outcome.started > 0 && (
            <p>{t('started', { started: outcome.started, title: outcome.title })}</p>
          )}
          {outcome.failed.length > 0 && (
            <div className="mt-1 text-red-700 dark:text-red-400">
              <p className="font-medium">{t('failedTitle', { failed: outcome.failed.length })}</p>
              <ul>
                {outcome.failed.map((item, i) => (
                  <li key={i}>
                    {t('failedLine', {
                      agent: item.agent,
                      summary: item.summary,
                      error: item.error || t('failedGeneric'),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
