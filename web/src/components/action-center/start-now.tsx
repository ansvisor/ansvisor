'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FilePen, Loader2, MessageSquare } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { runChatOnAction } from '@/components/chat/agents/agent-requests';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/use-user-role';
import {
  startAgentWriting,
  startDraftFromAction,
  type ActionStartedDraft,
  type AgentWriteError,
} from '@/lib/actions/content-drafts';
import { agentWriteRequest, useRuleDescriber, type RuleDescriber } from '@/lib/content/agent-write';
import {
  findActionDraft,
  startNowDrafts,
  startNowPages,
  type ActionDraft,
  type StartNowWork,
} from '@/lib/content/action-drafts';
import { actionLibraryPath, contentEditorPath, startedDraftPath } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';
import { useBrandStore } from '@/stores/use-brand-store';
import { useShowChat } from './use-show-chat';

/** The action Start now works on: its id, number and title as the page names it. */
export interface StartNowAction {
  id: string;
  actionNo: number;
  title: string;
}

/**
 * Write this's job on a draft Start now just wrote (content-writer.js
 * briefThenWrite): the Content Agent builds the brief from the draft's
 * prompts, fan-outs and cited pages, then writes the new page (or leaves
 * suggestions on the live one) while the editor shows it at work. The same
 * request and the same API route as Content › Opportunities' Write this, so
 * the same AI usage and plan rules apply.
 */
async function writeStartedDraft(
  id: string,
  brandId: string,
  draft: ActionStartedDraft,
  describe: RuleDescriber,
  language: string | null | undefined,
): Promise<{ started: true } | { error: AgentWriteError }> {
  try {
    const request = await agentWriteRequest({ id, brandId, ...draft, language }, describe);
    return await startAgentWriting(id, brandId, { ...request, buildBrief: true });
  } catch (err) {
    console.error("Failed to hand Start now's draft to the Content Agent:", err);
    return { error: 'failed' };
  }
}

/**
 * Start now in the Content Editor (AC-ACTION-PLAN spec §10): the draft for
 * the action's writing work, one per page of a multi-page play, each
 * written by startDraftFromAction with a page's title, the action's
 * prompts, page, page type and locked products. One new draft has the
 * Content Agent write its brief and page (Write this's job) and opens in
 * the editor as it writes; a page that couldn't be read opens with its
 * brief built as it opens, as before. Several open the Library on the
 * action's drafts. A draft already written opens as it is. The drawer's
 * Start now and the Actions list's row menu both start here.
 */
export function useStartNow(brandId: string) {
  const t = useTranslations('actionCenter.actionsPage.startNow');
  const tAgent = useTranslations('contentEditor.newContent.start.agentErrors');
  const router = useRouter();
  const describeRule = useRuleDescriber();
  const language = useBrandStore((s) => s.brands.find((b) => b.id === brandId)?.language);
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (action: StartNowAction, work: StartNowWork, drafts: readonly ActionDraft[]) => {
      if (busy) return;
      setBusy(true);
      try {
        const pages = startNowPages(work);
        const written: { draftId: string; created: boolean; draft?: ActionStartedDraft }[] = [];
        let unread = false;
        for (const page of pages) {
          const had = findActionDraft(drafts, work.method, page);
          if (had) {
            written.push({ draftId: had.id, created: false });
            continue;
          }
          const result = await startDraftFromAction(brandId, action.id, work.taskId, {
            page,
            title: action.title,
            // A bridge links page gets its links in Your input (AC plan P-10).
            linkLabels: {
              name: t('linkTable.name'),
              linkTo: t('linkTable.linkTo'),
              anchor: t('linkTable.anchor'),
            },
          });
          if ('error' in result) {
            // The drafts already written stay; the Library lists them.
            if (written.length) break;
            toast.error(t('failed'));
            return;
          }
          if (result.importFailed) unread = true;
          written.push({
            draftId: result.draftId,
            created: result.created,
            // A page that couldn't be read has nothing to suggest changes to, as in Write this.
            draft: result.importFailed ? undefined : result.draft,
          });
        }
        if (unread) toast.warning(t('pageNotRead'));
        if (pages.length === 1 && written.length === 1) {
          const [only] = written;
          if (only.created && only.draft) {
            const started = await writeStartedDraft(
              only.draftId,
              brandId,
              only.draft,
              describeRule,
              language,
            );
            // The draft opens either way, with its title to write from.
            if ('error' in started) {
              toast.error(tAgent(tAgent.has(started.error) ? started.error : 'failed'));
            }
            router.push(contentEditorPath(only.draftId));
            return;
          }
          router.push(
            only.created ? startedDraftPath(only.draftId) : contentEditorPath(only.draftId),
          );
          return;
        }
        if (written.length < pages.length) toast.error(t('someFailed'));
        router.push(actionLibraryPath(action.id));
      } finally {
        setBusy(false);
      }
    },
    [brandId, busy, describeRule, language, router, t, tAgent],
  );

  return { busy, start };
}

/**
 * Do it with Chat on the action (spec §10, K11): the person's own Chat run
 * on it (Run with Chat, CHAT-21 §F), opened beside the action. Admins and
 * Managers, as Run agent; the workspace's plan as every Chat run.
 */
function useChatStart(action: StartNowAction) {
  const t = useTranslations('actionCenter.actionsPage.runAgent');
  const tStart = useTranslations('actionCenter.actionsPage.startNow');
  const tActions = useTranslations('readOnly.actions');
  const { openUpgrade } = useUpgradeGate();
  const showChat = useShowChat();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await runChatOnAction(
        action.id,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      if (!answer.ok) {
        if (answer.failure === 'subscription') openUpgrade(tActions('runAgentOnAction'));
        else toast.error(answer.message ?? tStart('chatFailed'));
        return;
      }
      const words = { no: action.actionNo };
      toast(
        answer.repeated
          ? t('toast.repeated')
          : answer.queued
            ? t('toast.chatQueued', words)
            : t('toast.chatStarted', words),
      );
      showChat(answer.chatId);
    } finally {
      setBusy(false);
    }
  };
  return { busy, start };
}

/**
 * The drawer's Start now block (spec §10 item 6, mockup "E-commerce ·
 * product pages to optimize"): Content Editor, which writes the action's
 * draft (or opens the one written), and Chat. Until the new Chat is on for
 * the workspace, Chat shows with a Soon badge and does nothing (K11); with
 * it on, it's for Admins and Managers, as Run agent. Nothing runs on its
 * own: each is the person's click, and on a read-only workspace or the demo
 * brand each opens the plan dialog instead.
 */
export function StartNowBlock({
  brandId,
  action,
  work,
  drafts,
}: {
  brandId: string;
  action: StartNowAction;
  work: StartNowWork;
  /** The drafts already written for the action's work. */
  drafts: readonly ActionDraft[];
}) {
  const t = useTranslations('actionCenter.actionsPage.startNow');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const chatOn = useChatAgentic();
  const { canManage } = useUserRole();
  const editor = useStartNow(brandId);
  const chat = useChatStart(action);

  const pages = startNowPages(work);
  const written = startNowDrafts(work, drafts);
  const several = pages.length > 1;
  const hint = written
    ? several
      ? t('hint.writtenSeveral', { count: pages.length })
      : t('hint.written')
    : work.method === 'create'
      ? t('hint.create')
      : several
        ? t('hint.optimizeSeveral', { count: pages.length })
        : pages[0]
          ? t('hint.optimizePage', { page: pagePath(pages[0]) })
          : t('hint.optimize');

  const onEditor = guard(() => void editor.start(action, work, drafts), {
    action: tActions(work.method === 'optimize' ? 'optimizeContent' : 'createContent'),
  });
  const onChat = guard(() => void chat.start(), { action: tActions('runAgentOnAction') });
  const busy = editor.busy || chat.busy;

  return (
    <section aria-label={t('title')} className="space-y-2 rounded-lg border px-3 py-3">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={busy}
          onClick={onEditor}
          data-action="actionCenter.startNow.editor"
        >
          {editor.busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FilePen className="h-3.5 w-3.5" aria-hidden />
          )}
          {written
            ? several
              ? t('openDrafts', { count: pages.length })
              : t('openDraft')
            : several
              ? t('editorSeveral', { count: pages.length })
              : t('editor')}
        </Button>
        {!chatOn ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled
            title={t('chatSoonHint')}
            data-action="actionCenter.startNow.chat"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {t('chat')}
            <Badge variant="outline" className="text-[10px]">
              {t('soon')}
            </Badge>
          </Button>
        ) : canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={busy}
            title={t('chatHint')}
            onClick={onChat}
            data-action="actionCenter.startNow.chat"
          >
            {chat.busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            )}
            {t('chat')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
