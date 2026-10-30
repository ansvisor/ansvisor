'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApprovalCard } from '@/components/agentic/approval-card';
import { DenialCard } from '@/components/agentic/denial-card';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { requestAccess } from '@/lib/actions/chat-access-requests';
import { searchChatReferences } from '@/lib/actions/chat-references';
import type { ChatEvent } from '@/lib/chat/events';
import type { ChatMode } from '@/lib/chat/precedence';
import { readSse } from '@/lib/chat/run-hub';
import {
  applyChatEvent,
  emptyRun,
  type ClientRun,
  type ClientRunStatus,
} from '@/lib/chat/run-state';
import type { ChatThread } from '@/lib/chat/thread';
import { dropChatUpload, uploadChatFile } from '@/lib/chat/upload-client';
import { useBrandStore } from '@/stores/use-brand-store';
import type { ChatReference } from '@/lib/chat/references';
import {
  ChatComposer,
  type ComposerChip,
  type ComposerDraft,
  type ComposerSend,
  type ComposerVariant,
} from './composer/chat-composer';
import { AnswerActions } from './run/answer-actions';
import { DeliverableCard, filedNumbers } from './run/deliverable-card';
import { RunAnswer } from './run/run-answer';
import { ChatUsageNotice, ComposerUsageMeter, chatAtCap } from './chat-usage';

interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  /** An answer's run: its handle and what its events built. */
  runId?: string | null;
  run?: ClientRun;
  /** When this page first saw it work, for the header's clock. */
  startedAt?: number;
  /** Its answer in Files (Save to Files). */
  fileId?: string | null;
  timezone?: string | null;
}

const OPEN: ClientRunStatus[] = ['queued', 'running', 'waiting'];

/** The events after which a run's stream ends: it waits on the person, or it ended. */
const SETTLING = new Set<string>([
  'confirm.required',
  'run.finished',
  'run.error',
  'run.paused_cap',
  'run.stopped',
]);

function turnsOf(thread: ChatThread | null): Turn[] {
  return (thread?.messages ?? []).map((message, i) => {
    const turn: Turn = { key: `saved-${i}`, role: message.role, text: message.text };
    if (message.role === 'assistant' && message.run) {
      turn.runId = message.run.runId;
      turn.timezone = message.timezone;
      turn.fileId = message.run.fileId;
      turn.run = {
        ...emptyRun(message.run.status as ClientRunStatus),
        steps: message.run.steps,
        deliverables: message.run.deliverables ?? [],
        text: message.text,
        generatedAt: message.generatedAt,
        dataAsOf: message.dataAsOf,
      };
    }
    return turn;
  });
}

/**
 * A chat in Chat (CHAT-01, Wave 1): its messages, each answer as its run
 * works (RunAnswer, W1-14), and the composer (W1-10…13) under them; Chat
 * Home's composer (`variant="home"`) starts a new chat. A run still under way
 * when the page opens is rebuilt from its events and keeps streaming; a
 * dropped stream reconnects from its last event. Steering stops the run,
 * its done steps kept, and sends the text as the next message (decided
 * 2026-10-30). A teammate's shared chat is read only. In the side panel
 * (`variant="panel"`, CHAT-01 items 15–24) the page's address stays: the
 * panel is told the chat's id with every message it takes, and `empty`
 * shows until the first one; the page's context chips and @ references go
 * with each message as its scope (W1-08, CHAT-04 item 8).
 */
export function ChatThreadView({
  thread,
  variant,
  defaultMode,
  fullAutoOpen,
  fullAutoOffByAdmin = false,
  onConversation,
  empty,
  usageNoticeSeen = null,
  chips,
  onRemoveChip,
  pageReferences,
  pageRoute,
  draft,
  onOwnKey = false,
}: {
  thread: ChatThread | null;
  variant: ComposerVariant;
  defaultMode: ChatMode;
  fullAutoOpen: boolean;
  fullAutoOffByAdmin?: boolean;
  /** In the side panel: the chat's id after each message it takes, instead of the address changing. */
  onConversation?: (conversationId: string) => void;
  /** What shows before the first message (the side panel's greeting). */
  empty?: ReactNode;
  /** The AI usage period whose 80% line the person already saw. */
  usageNoticeSeen?: string | null;
  /** The page's context as chips (the side panel, CHAT-01 item 20). */
  chips?: ComposerChip[];
  onRemoveChip?: (key: string) => void;
  /** What on the page can be asked about, first in the @ menu. */
  pageReferences?: ChatReference[];
  /** The page the message is sent from, kept with it. */
  pageRoute?: string;
  /** A question or an object the page hands the box. */
  draft?: ComposerDraft | null;
  /** Chat runs on the workspace's own key: a used-up allowance doesn't pause it. */
  onOwnKey?: boolean;
}) {
  const t = useTranslations('chatPage');
  const tLimit = useTranslations('chatComposer.limit');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { isLocked, openUpgrade } = useUpgradeGate();
  // At the AI limit, Chat pauses: the composer is off (CHAT-04 item 17).
  const { usage, refresh: refreshUsage } = useAiUsage();
  const atCap = chatAtCap(usage, onOwnKey);
  const [turns, setTurns] = useState<Turn[]>(() => turnsOf(thread));
  const [conversationId, setConversationId] = useState<string | null>(
    thread?.conversationId ?? null,
  );
  const [mode, setMode] = useState<ChatMode>(defaultMode);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const resumed = useRef(false);
  const brandId = thread?.brandId ?? activeBrandId ?? null;

  const last = turns[turns.length - 1];
  const working = !!last?.run && OPEN.includes(last.run.status);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);

  // A run that stopped working spent some of the AI usage: the meter, the 80%
  // line and the pause read it again, once per run, not on a timer.
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) refreshUsage();
    wasWorking.current = working;
  }, [working, refreshUsage]);

  const updateRun = useCallback((key: string, fn: (turn: Turn) => Turn) => {
    setTurns((all) => all.map((turn) => (turn.key === key ? fn(turn) : turn)));
  }, []);

  /** Applies a stream's events to the answer, and reconnects once it drops mid-run. */
  const consume = useCallback(
    async (key: string, body: ReadableStream<Uint8Array>, runId: string, tries = 3) => {
      let lastSeq = 0;
      let settled = false;
      for await (const event of readSse(body)) {
        lastSeq = Math.max(lastSeq, event.seq);
        settled ||= SETTLING.has(event.type);
        updateRun(key, (turn) => ({
          ...turn,
          run: applyChatEvent(turn.run ?? emptyRun(), event as ChatEvent),
          startedAt: turn.startedAt ?? Date.now(),
        }));
      }
      // A stream ends when the run waits or ends; one that ends otherwise lost its connection.
      if (!settled && tries > 0) {
        setReconnecting(true);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await fetch(`/api/chat/runs/${runId}/events?after=${lastSeq}`).catch(
          () => null,
        );
        setReconnecting(false);
        if (res?.ok && res.body) await consume(key, res.body, runId, tries - 1);
      }
    },
    [updateRun],
  );

  // A run under way when the page opened: rebuilt from its events, then live.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const open = turns[turns.length - 1];
    if (!open?.runId || !open.run || !OPEN.includes(open.run.status)) return;
    const runId = open.runId;
    updateRun(open.key, (turn) => ({ ...turn, run: emptyRun(), startedAt: Date.now() }));
    void fetch(`/api/chat/runs/${runId}/events?after=0`).then((res) => {
      if (res.ok && res.body) void consume(open.key, res.body, runId);
    });
  }, [turns, consume, updateRun]);

  /** A message to Chat: false when it wasn't taken, so the composer keeps it. */
  async function send(message: string, sent: ComposerSend): Promise<boolean> {
    if (isLocked) {
      openUpgrade();
      return false;
    }
    const questionKey = `you-${Date.now()}`;
    const answerKey = `answer-${Date.now()}`;
    setTurns((all) => [
      ...all,
      { key: questionKey, role: 'user', text: message },
      {
        key: answerKey,
        role: 'assistant',
        text: '',
        run: emptyRun('queued'),
        startedAt: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ]);
    const res = await fetch('/api/chat/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        mode,
        conversationId: conversationId ?? undefined,
        brandId: conversationId ? undefined : (brandId ?? undefined),
        // A chat the side panel starts names the page it started on.
        ...(!conversationId && variant === 'panel' && pageRoute
          ? { origin: 'panel', originPage: pageRoute }
          : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(sent.attachments.length > 0 ? { attachmentIds: sent.attachments } : {}),
        ...(sent.context.length > 0 ? { context: { route: pageRoute, chips: sent.context } } : {}),
        ...(sent.references.length > 0 ? { references: sent.references } : {}),
      }),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      const body = (await res?.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      setTurns((all) => all.filter((turn) => turn.key !== answerKey && turn.key !== questionKey));
      if (body?.code === 'subscription_inactive') openUpgrade();
      else toast.error(body?.error ?? t('sendFailed'));
      return false;
    }
    const chatId = res.headers.get('x-chat-conversation');
    const runId = res.headers.get('x-chat-run');
    if (chatId && !conversationId) {
      setConversationId(chatId);
      if (!onConversation) window.history.replaceState(null, '', `/dashboard/chat/${chatId}`);
    }
    const id = chatId ?? conversationId;
    if (id) onConversation?.(id);
    updateRun(answerKey, (turn) => ({ ...turn, runId }));
    if (runId) void consume(answerKey, res.body, runId);
    return true;
  }

  /** Approve (or the click) or Skip on the card the run waits on. */
  async function answer(turn: Turn, action: 'approve' | 'skip', dontAskAgain = false) {
    const run = turn.run;
    if (!turn.runId || !run?.confirm) return;
    const runId = turn.runId;
    const body =
      action === 'approve'
        ? { n: run.confirm.n, digest: run.confirm.digest, dontAskAgain }
        : { n: run.confirm.n };
    const res = await fetch(`/api/chat/runs/${runId}/${action}?after=${run.lastSeq}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      const failed = (await res?.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (failed?.code === 'subscription_inactive') openUpgrade();
      else toast.error(failed?.error ?? t('answerFailed'));
      // The card may have changed (approval_mismatch): the run's events show it again.
      const events = await fetch(`/api/chat/runs/${runId}/events?after=${run.lastSeq}`);
      if (events.ok && events.body) await consume(turn.key, events.body, runId);
      return;
    }
    await consume(turn.key, res.body, runId);
  }

  /** Stops the run under way: false when the Stop wasn't taken. */
  async function stop(): Promise<boolean> {
    if (!last?.runId) return true;
    const res = await fetch(`/api/chat/runs/${last.runId}/stop`, { method: 'POST' }).catch(
      () => null,
    );
    if (!res?.ok) return false;
    // A run nothing drives (queued, waiting) is ended by the Stop itself: its events say so.
    if (last.run && last.run.status !== 'running') {
      const events = await fetch(`/api/chat/runs/${last.runId}/events?after=${last.run.lastSeq}`);
      if (events.ok && events.body) await consume(last.key, events.body, last.runId);
    }
    return true;
  }

  return (
    <div
      className={
        variant === 'home'
          ? 'mx-auto flex w-full max-w-[720px] flex-col gap-5 px-5 pb-6'
          : variant === 'panel'
            ? 'flex w-full flex-1 flex-col gap-4 px-4 pt-4'
            : 'mx-auto flex w-full max-w-[760px] flex-col gap-5 px-5 py-6'
      }
    >
      {turns.length === 0 && empty}
      {turns.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <li key={turn.key} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm whitespace-pre-wrap">
                  <span className="sr-only">{t('you')}: </span>
                  {turn.text}
                </div>
              </li>
            ) : (
              <li key={turn.key}>
                <Answer
                  turn={turn}
                  now={now}
                  reconnecting={reconnecting && turn === last}
                  onApprove={(dontAskAgain) => answer(turn, 'approve', dontAskAgain)}
                  onSkip={() => answer(turn, 'skip')}
                  onFiled={(fileId) => updateRun(turn.key, (was) => ({ ...was, fileId }))}
                />
              </li>
            ),
          )}
        </ol>
      )}
      <div
        className={
          variant === 'home'
            ? 'flex flex-col gap-2'
            : variant === 'panel'
              ? 'sticky bottom-0 mt-auto flex flex-col gap-2 bg-background pt-1 pb-3'
              : 'sticky bottom-0 flex flex-col gap-2 bg-background pt-1 pb-2'
        }
      >
        {(!thread || thread.mine) && (
          <ChatUsageNotice seenPeriod={usageNoticeSeen} onOwnKey={onOwnKey} />
        )}
        <ChatComposer
          variant={variant}
          mode={mode}
          onModeChange={setMode}
          fullAutoOpen={fullAutoOpen}
          fullAutoOffByAdmin={fullAutoOffByAdmin}
          running={working}
          sharedReadOnly={!!thread && !thread.mine}
          disabled={atCap}
          placeholder={atCap ? tLimit(usage?.trial ? 'trial' : 'paid') : undefined}
          usage={<ComposerUsageMeter />}
          chips={chips}
          onRemoveChip={onRemoveChip}
          references={pageReferences}
          draft={draft}
          onSend={send}
          onStop={() => void stop()}
          onSteer={async (message, sent) => {
            // Only once the Stop is taken: else two runs would answer in one chat.
            if (!(await stop())) {
              toast.error(t('sendFailed'));
              return false;
            }
            return send(message, sent);
          }}
          searchReferences={
            brandId
              ? (q) => searchChatReferences(brandId, q).then((r) => (r.ok ? r.references : []))
              : undefined
          }
          uploader={{
            upload: (file) => uploadChatFile(file, conversationId),
            remove: dropChatUpload,
          }}
        />
      </div>
    </div>
  );
}

/** One answer: its run as it works, with the cards it waits on or was refused with. */
function Answer({
  turn,
  now,
  reconnecting,
  onApprove,
  onSkip,
  onFiled,
}: {
  turn: Turn;
  now: number;
  reconnecting: boolean;
  onApprove: (dontAskAgain: boolean) => Promise<void>;
  onSkip: () => Promise<void>;
  onFiled: (fileId: string) => void;
}) {
  const t = useTranslations('chatPage');
  const run = turn.run ?? { ...emptyRun('done'), text: turn.text };
  const workingMs = run.summary?.workingMs ?? (turn.startedAt ? now - turn.startedAt : 0);
  const confirmStep = run.confirm ? run.steps.find((s) => s.n === run.confirm!.n) : undefined;
  const filedAt = filedNumbers(run.deliverables);

  const cards = (
    <>
      {run.denials.map((denial, i) => (
        <DenialCard
          key={i}
          title={t('deniedTitle')}
          asked={denial.asked}
          why={denial.rule.detail}
          whySource={denial.rule.source}
          whoCan={denial.whoCan}
          nextActions={denial.nextActions}
          onAskAdmin={async () => {
            const sent = await requestAccess({
              asked: denial.asked.slice(0, 500),
              ruleKind: denial.rule.kind,
              ruleDetail: denial.rule.detail.slice(0, 500),
            });
            if (!sent.ok) throw new Error(sent.reason);
          }}
        />
      ))}
      {run.confirm && (
        <ApprovalCard
          kind={confirmStep?.kind === 'execute' ? 'execute' : 'write'}
          step={{ n: run.confirm.n, total: Math.max(run.steps.length, run.confirm.n) }}
          title={run.confirm.action}
          items={run.confirm.target ? [{ title: run.confirm.target }] : undefined}
          summary={confirmStep?.kind === 'execute' ? run.confirm.target : undefined}
          actionLabel={confirmStep?.kind === 'execute' ? run.confirm.action : undefined}
          canDontAskAgain={run.confirm.canDontAskAgain}
          onApprove={(answer) => void onApprove(answer.dontAskAgain)}
          onSkip={() => void onSkip()}
        />
      )}
      {turn.runId &&
        run.deliverables.map((deliverable, i) => (
          <DeliverableCard
            key={`${deliverable.title}-${i}`}
            runId={turn.runId!}
            // Its place among the filed ones, as the server counts them: one not filed has none.
            n={filedAt[i] ?? 0}
            deliverable={deliverable}
          />
        ))}
      {run.status === 'paused_cap' && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{t('pausedCap')}</p>
      )}
      {run.status === 'error' && run.errorReason && (
        <p className="text-sm text-red-700 dark:text-red-400">{run.errorReason}</p>
      )}
    </>
  );

  return (
    <RunAnswer
      run={run}
      workingMs={workingMs}
      timezone={turn.timezone}
      reconnecting={reconnecting}
      cards={cards}
      footer={
        turn.runId && run.text.trim() ? (
          <AnswerActions
            runId={turn.runId}
            markdown={run.text}
            filed={!!turn.fileId}
            onFiled={onFiled}
          />
        ) : undefined
      }
    />
  );
}
