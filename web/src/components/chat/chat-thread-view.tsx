'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApprovalCard } from '@/components/agentic/approval-card';
import { DenialCard } from '@/components/agentic/denial-card';
import {
  QuestionAnswered,
  QuestionCard,
  type QuestionAnswerValue,
} from '@/components/agentic/question-card';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { requestAccess } from '@/lib/actions/chat-access-requests';
import { searchChatReferences } from '@/lib/actions/chat-references';
import { ANSWER_MAX, composerAnswer, recommendedLabel } from '@/lib/chat/asks';
import type { ChatSkillItem } from '@/lib/chat/composer-setup';
import { ghostOf } from '@/lib/chat/next-moves';
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
import { NextMoves } from './run/next-moves';
import { RunAnswer } from './run/run-answer';
import { StaffDebug } from './run/staff-debug';
import { useChatDebug } from './chat-debug';
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
  /**
   * A question as it was sent, for Retry to send it again: its page chips,
   * @ references and the page they came from. Null when it can't go again
   * as it was: it had files (each goes with one message only), or it was
   * read back with a scope this page doesn't hold.
   */
  resend?: Resend | null;
}

interface Resend {
  context: ComposerChip[];
  references: ChatReference[];
  route?: string;
}

const OPEN: ClientRunStatus[] = ['queued', 'running', 'waiting'];

/** The events after which a run's stream ends: it waits on the person, or it ended. */
const SETTLING = new Set<string>([
  'confirm.required',
  'ask.created',
  'run.finished',
  'run.error',
  'run.paused_cap',
  'run.stopped',
]);

function turnsOf(thread: ChatThread | null): Turn[] {
  return (thread?.messages ?? []).map((message, i) => {
    const turn: Turn = { key: `saved-${i}`, role: message.role, text: message.text };
    // A saved question goes again only as it was: without files or a scope.
    if (message.role === 'user') {
      turn.resend = message.resendable === false ? null : { context: [], references: [] };
    }
    if (message.role === 'assistant' && message.run) {
      turn.runId = message.run.runId;
      turn.timezone = message.timezone;
      turn.fileId = message.run.fileId;
      turn.run = {
        ...emptyRun(message.run.status as ClientRunStatus),
        steps: message.run.steps,
        deliverables: message.run.deliverables ?? [],
        nextMoves: message.run.nextMoves ?? [],
        text: message.text,
        generatedAt: message.generatedAt,
        dataAsOf: message.dataAsOf,
        summary: message.run.summary ?? null,
        errorReason: message.run.errorReason ?? null,
      };
    }
    return turn;
  });
}

/**
 * How long a dropped stream waits before each try to reconnect (CHAT-03
 * item 21); a try that brings events starts the count again.
 */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/** Waits `ms`, or less when `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** The question an answer answers: the person's message right before it. */
function questionOf(turns: Turn[], index: number): Turn | null {
  const before = turns[index - 1];
  return before?.role === 'user' && before.text.trim() ? before : null;
}

/**
 * A chat in Chat (CHAT-01, Wave 1): its messages, each answer as its run
 * works (RunAnswer, W1-14), and the composer (W1-10…13) under them; Chat
 * Home's composer (`variant="home"`) starts a new chat. A run still under way
 * when the page opens is rebuilt from its events and keeps streaming, its
 * kept steps shown until they come; a dropped or broken stream says
 * "Reconnecting…" and resumes after its last event (W1-15). An answer that
 * ended in error says why, after a reload too, and Retry sends its question
 * again; Ansvisor staff can switch on the Debug view. Steering stops the run,
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
  skills,
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
  /** The enabled skills, for the / menu (CHAT-13 item 5). */
  skills?: ChatSkillItem[];
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
  // While the view is on screen: what it streams stops once it goes (another
  // page, the side panel closed), so nothing keeps listening or warns there.
  const life = useRef<AbortController | null>(null);
  // Read when a stream gives up, so following a run never waits on a render.
  const lostWords = useRef(t('connectionLost'));
  // The run under way when the page opened, which it picks up again.
  const [resumable] = useState(() => {
    const open = turns[turns.length - 1];
    return open?.runId && open.run && OPEN.includes(open.run.status)
      ? { key: open.key, runId: open.runId }
      : null;
  });
  const brandId = thread?.brandId ?? activeBrandId ?? null;

  const last = turns[turns.length - 1];
  const working = !!last?.run && OPEN.includes(last.run.status);
  // A question the run waits on: the composer's message answers it (CHAT-07 §A item 8).
  const asking = last?.run?.question ?? null;
  // The latest answer's next moves, once it finished, in the person's own chat (CHAT-07 §C).
  const nextMoves =
    last?.run?.status === 'done' && (!thread || thread.mine) ? last.run.nextMoves : [];

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

  /**
   * Applies a run's events to its answer until the run waits on the person
   * or ends (CHAT-03 item 21). A stream that ends otherwise, or breaks, lost
   * its connection: the header says "Reconnecting…" and the events after the
   * last one applied (`from`, then each event's seq) are asked for again, a
   * few times, longer apart each time; when none come back the person is
   * told. `rebuild`: the first event builds the answer anew (a run read
   * again after a reload), its kept steps showing until then. Once the view
   * is gone (`signal`, the view's life when it was called) it stops at once:
   * the stream is cancelled, no reconnect, no warning.
   */
  const follow = useCallback(
    async (
      key: string,
      runId: string,
      first: ReadableStream<Uint8Array> | null,
      from = 0,
      rebuild = false,
      signal: AbortSignal | undefined = life.current?.signal,
    ) => {
      if (!signal || signal.aborted) {
        void first?.cancel().catch(() => {});
        return;
      }
      let body = first;
      let lastSeq = from;
      let fresh = rebuild;
      let tries = 0;
      for (;;) {
        let settled = false;
        if (body) {
          try {
            for await (const event of readSse(body, signal)) {
              lastSeq = Math.max(lastSeq, event.seq);
              settled ||= SETTLING.has(event.type);
              tries = 0;
              const anew = fresh;
              fresh = false;
              updateRun(key, (turn) => ({
                ...turn,
                run: applyChatEvent(anew || !turn.run ? emptyRun() : turn.run, event as ChatEvent),
                startedAt: turn.startedAt ?? Date.now(),
              }));
            }
          } catch {
            // The connection broke mid-stream: reconnected below.
          }
        }
        if (signal.aborted) return;
        if (settled) break;
        if (tries >= RECONNECT_DELAYS_MS.length) {
          toast.error(lostWords.current);
          break;
        }
        setReconnecting(true);
        await wait(RECONNECT_DELAYS_MS[tries], signal);
        if (signal.aborted) return;
        tries += 1;
        const res = await fetch(`/api/chat/runs/${runId}/events?after=${lastSeq}`, {
          signal,
        }).catch(() => null);
        body = res?.ok && res.body ? res.body : null;
        if (body) setReconnecting(false);
      }
      setReconnecting(false);
    },
    [updateRun],
  );

  // The view's life; a run under way when the page opened is rebuilt from
  // its events, then followed live, until the view goes.
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    if (resumable) {
      const { key, runId } = resumable;
      updateRun(key, (turn) => ({ ...turn, startedAt: Date.now() }));
      void fetch(`/api/chat/runs/${runId}/events?after=0`, { signal: controller.signal })
        .catch(() => null)
        .then((res) =>
          follow(key, runId, res?.ok && res.body ? res.body : null, 0, true, controller.signal),
        );
    }
    return () => {
      controller.abort();
      if (life.current === controller) life.current = null;
    };
  }, [resumable, follow, updateRun]);

  /**
   * A message to Chat: false when it wasn't taken, so the composer keeps it.
   * `route`: the page its chips came from, when not this one (a Retry).
   */
  async function send(message: string, sent: ComposerSend, route = pageRoute): Promise<boolean> {
    if (isLocked) {
      openUpgrade();
      return false;
    }
    const questionKey = `you-${Date.now()}`;
    const answerKey = `answer-${Date.now()}`;
    setTurns((all) => [
      ...all,
      {
        key: questionKey,
        role: 'user',
        text: message,
        resend:
          sent.attachments.length > 0
            ? null
            : { context: sent.context, references: sent.references, route },
      },
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
        ...(sent.context.length > 0 ? { context: { route, chips: sent.context } } : {}),
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
    if (runId) void follow(answerKey, runId, res.body);
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
      const events = await fetch(`/api/chat/runs/${runId}/events?after=${run.lastSeq}`, {
        signal: life.current?.signal,
      }).catch(() => null);
      if (events?.ok && events.body) await follow(turn.key, runId, events.body, run.lastSeq);
      return;
    }
    await follow(turn.key, runId, res.body, run.lastSeq);
  }

  /** An answer to the question card the run waits on: from the card, or the composer's text. */
  async function answerQuestion(
    turn: Turn,
    value: QuestionAnswerValue,
    via: 'card' | 'composer' = 'card',
  ): Promise<boolean> {
    const run = turn.run;
    if (!turn.runId || !run?.question) return false;
    const runId = turn.runId;
    const res = await fetch(`/api/chat/runs/${runId}/answer?after=${run.lastSeq}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: run.question.n, ...value, via }),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      const failed = (await res?.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (failed?.code === 'subscription_inactive') openUpgrade();
      else toast.error(failed?.error ?? t('answerFailed'));
      // Already answered elsewhere: the run's events show where it went.
      const events = await fetch(`/api/chat/runs/${runId}/events?after=${run.lastSeq}`, {
        signal: life.current?.signal,
      }).catch(() => null);
      if (events?.ok && events.body) await follow(turn.key, runId, events.body, run.lastSeq);
      return false;
    }
    // The next question asked with it comes up: say so (CHAT-07 §A item 6).
    const batch = run.question.batch;
    if (via === 'card' && batch && batch.at < batch.of) {
      toast(t('questionNext', { at: batch.at + 1, of: batch.of }));
    }
    // The run goes on as it streams: the composer is free again at once.
    void follow(turn.key, runId, res.body, run.lastSeq);
    return true;
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
      const events = await fetch(`/api/chat/runs/${last.runId}/events?after=${last.run.lastSeq}`, {
        signal: life.current?.signal,
      }).catch(() => null);
      if (events?.ok && events.body)
        await follow(last.key, last.runId, events.body, last.run.lastSeq);
    }
    return true;
  }

  /**
   * Retry on the answer at `index` (CHAT-03 item 18): its question, sent
   * again as it was, with its page chips and @ references. The latest answer
   * only, once nothing works and Chat isn't paused at the AI limit; none on a
   * teammate's chat, or for a question that can't go again as it was (files).
   */
  function retryOf(index: number): (() => void) | undefined {
    const question = questionOf(turns, index);
    const resend = question?.resend;
    if (!question || !resend || index !== turns.length - 1) return undefined;
    if ((thread && !thread.mine) || working || atCap) return undefined;
    return () =>
      void send(
        question.text,
        { context: resend.context, references: resend.references, attachments: [] },
        resend.route,
      );
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
          {turns.map((turn, index) =>
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
                  onAnswerQuestion={(value) => answerQuestion(turn, value)}
                  onFiled={(fileId) => updateRun(turn.key, (was) => ({ ...was, fileId }))}
                  onRetry={retryOf(index)}
                />
                {turn === last && (
                  <NextMoves
                    moves={nextMoves}
                    narrow={variant === 'panel'}
                    disabled={atCap}
                    onPick={(move) =>
                      void send(move.prompt, {
                        context: chips ?? [],
                        references: [],
                        attachments: [],
                      })
                    }
                  />
                )}
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
          running={working && !asking}
          answering={!!asking}
          maxLength={asking ? ANSWER_MAX : undefined}
          ghost={asking ? recommendedLabel(asking) : ghostOf(nextMoves)}
          sharedReadOnly={!!thread && !thread.mine}
          disabled={atCap}
          placeholder={atCap ? tLimit(usage?.trial ? 'trial' : 'paid') : undefined}
          usage={<ComposerUsageMeter />}
          // An answer is its text only: no page chips, @ data or files go with it.
          chips={asking ? undefined : chips}
          onRemoveChip={onRemoveChip}
          references={asking ? undefined : pageReferences}
          skills={skills}
          draft={draft}
          onSend={(message, sent) =>
            asking && last
              ? answerQuestion(last, composerAnswer(asking, message), 'composer')
              : send(message, sent)
          }
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
            brandId && !asking
              ? (q) => searchChatReferences(brandId, q).then((r) => (r.ok ? r.references : []))
              : undefined
          }
          uploader={
            asking
              ? undefined
              : {
                  upload: (file) => uploadChatFile(file, conversationId),
                  remove: dropChatUpload,
                }
          }
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
  onAnswerQuestion,
  onFiled,
  onRetry,
}: {
  turn: Turn;
  now: number;
  reconnecting: boolean;
  onApprove: (dontAskAgain: boolean) => Promise<void>;
  onSkip: () => Promise<void>;
  onAnswerQuestion: (value: QuestionAnswerValue) => Promise<boolean>;
  onFiled: (fileId: string) => void;
  /** Sends its question again; none while another run works, or on a teammate's chat. */
  onRetry?: () => void;
}) {
  const t = useTranslations('chatPage');
  const debug = useChatDebug();
  const run = turn.run ?? { ...emptyRun('done'), text: turn.text };
  // The question being answered: saving lasts until it goes (its answer
  // streams in) or the answer failed.
  const [answeringN, setAnsweringN] = useState<number | null>(null);
  const answering = answeringN !== null && answeringN === run.question?.n;
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
      {run.steps
        .filter((step) => step.kind === 'ask' && step.status === 'done')
        .map((step) => (
          <QuestionAnswered key={step.n} question={step.label} answer={step.detail ?? ''} />
        ))}
      {run.question && (
        <QuestionCard
          key={run.question.n}
          ask={run.question}
          status={answering ? 'saving' : 'pending'}
          onAnswer={async (value) => {
            const n = run.question!.n;
            setAnsweringN(n);
            if (!(await onAnswerQuestion(value))) setAnsweringN(null);
          }}
        />
      )}
      {run.confirm && (
        <ApprovalCard
          kind={confirmStep?.kind === 'execute' ? 'execute' : 'write'}
          step={{ n: run.confirm.n, total: Math.max(run.steps.length, run.confirm.n) }}
          title={run.confirm.action}
          items={run.confirm.target ? [{ title: run.confirm.target }] : undefined}
          summary={confirmStep?.kind === 'execute' ? run.confirm.target : undefined}
          actionLabel={confirmStep?.kind === 'execute' ? run.confirm.action : undefined}
          canDontAskAgain={run.confirm.canDontAskAgain}
          note={
            [run.confirm.note, run.confirm.noUndo ? t('noUndo') : null].filter(Boolean).join(' ') ||
            undefined
          }
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
      {debug?.on && turn.runId && <StaffDebug runId={turn.runId} status={run.status} />}
    </>
  );

  return (
    <RunAnswer
      run={run}
      workingMs={workingMs}
      timezone={turn.timezone}
      reconnecting={reconnecting}
      onRetry={onRetry}
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
