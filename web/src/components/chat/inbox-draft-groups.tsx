'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  approveGroup,
  listDraftApprovalGroups,
  type ApproveFailure,
} from '@/lib/actions/chat-approve-all';
import type { ApprovalGroup } from '@/lib/chat/pending-approvals';

/** What Approve all did for a draft: how many changes were made, and the ones that weren't. */
interface Outcome {
  key: string;
  title: string;
  made: number;
  failed: ApproveFailure[];
}

/**
 * Drafts that several of the person's runs wait on (Needs you): "N changes
 * from M agents", each agent's change, which opens its chat, and one Approve
 * all. Approve all says how many changes were made and lists the ones that
 * weren't. When more than one change rewrites the page, they would overwrite
 * each other: the card asks for them one by one, from their own chats, and
 * offers no Approve all (the server refuses one too).
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
          { key: group.key, title: group.title, made: result.made, failed: result.failed },
        ]);
      } else {
        setProblem(
          t(
            result.reason === 'changed'
              ? 'changed'
              : result.reason === 'one_by_one'
                ? 'oneByOne'
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
            {group.together && (
              <Button
                size="sm"
                data-action="inbox.approveAll"
                disabled={busy !== null}
                onClick={() => void approve(group)}
              >
                {t(busy === group.key ? 'approving' : 'approveAll')}
              </Button>
            )}
          </div>
          {!group.together && (
            <p className="mt-1 text-xs" data-testid="inbox-one-by-one">
              {t('oneByOne')}
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {group.items.map((item, i) => (
              <li key={i}>
                <Link
                  href={`/dashboard/chat/${item.chatId}`}
                  data-action="inbox.draftGroupItem"
                  className="hover:text-foreground hover:underline"
                >
                  {item.agent} · {item.summary}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {outcomes.map((outcome) => (
        <div key={outcome.key} role="status" className="rounded-[14px] border p-3 text-xs">
          {outcome.made > 0 && <p>{t('made', { made: outcome.made, title: outcome.title })}</p>}
          {outcome.failed.length > 0 && (
            <div className="mt-1 text-red-700 dark:text-red-400">
              <p className="font-medium">{t('failedTitle', { failed: outcome.failed.length })}</p>
              <ul>
                {outcome.failed.map((item, i) => (
                  <li key={i}>
                    {t('failedLine', {
                      agent: item.agent,
                      summary: item.summary,
                      error: item.approved ? t('notMade') : item.error || t('failedGeneric'),
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
