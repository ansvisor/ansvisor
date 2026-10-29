'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { ApprovalCard } from '@/components/agentic/approval-card';
import { DenialCard } from '@/components/agentic/denial-card';
import { stampParts } from '@/components/agentic/result-card';
import { RunSteps, type RunStepsStatus } from '@/components/agentic/run-steps';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button, buttonVariants } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { requestAccess } from '@/lib/actions/chat-access-requests';
import type { ChatEvent } from '@/lib/chat/events';
import { readSse } from '@/lib/chat/run-hub';
import {
  applyChatEvent,
  emptyRun,
  type ClientRun,
  type ClientRunStatus,
} from '@/lib/chat/run-state';
import type { ChatThread } from '@/lib/chat/thread';
import { useBrandStore } from '@/stores/use-brand-store';
import { cn } from '@/lib/utils';

type Mode = 'ask_first' | 'auto' | 'full_auto';
const MODES: Mode[] = ['ask_first', 'auto', 'full_auto'];

interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  /** An answer's run: its handle and what its events built. */
  runId?: string | null;
  run?: ClientRun;
  /** When this page first saw it work, for the header's clock. */
  startedAt?: number;
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

const stepsStatus = (status: ClientRunStatus): RunStepsStatus =>
  status === 'done'
    ? 'done'
    : status === 'waiting'
      ? 'waiting'
      : status === 'error'
        ? 'error'
        : status === 'stopped' || status === 'paused_cap'
          ? 'stopped'
          : 'running';

function turnsOf(thread: ChatThread | null): Turn[] {
  return (thread?.messages ?? []).map((message, i) => {
    const turn: Turn = { key: `saved-${i}`, role: message.role, text: message.text };
    if (message.role === 'assistant' && message.run) {
      turn.runId = message.run.runId;
      turn.timezone = message.timezone;
      turn.run = {
        ...emptyRun(message.run.status as ClientRunStatus),
        steps: message.run.steps,
        text: message.text,
        generatedAt: message.generatedAt,
        dataAsOf: message.dataAsOf,
      };
    }
    return turn;
  });
}

/**
 * The engine's test page (C3): send a message, watch its steps stream, answer
 * its cards (D2's approval and denial cards) and Stop. A run still under way
 * when the page opens is rebuilt from its events and keeps streaming. Plain
 * on purpose: the real Chat shell (W1-01) replaces it.
 */
export function ChatTestView({ thread }: { thread: ChatThread | null }) {
  const t = useTranslations('chatPage');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { isLocked, openUpgrade } = useUpgradeGate();
  const [turns, setTurns] = useState<Turn[]>(() => turnsOf(thread));
  const [conversationId, setConversationId] = useState<string | null>(
    thread?.conversationId ?? null,
  );
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const resumed = useRef(false);

  const last = turns[turns.length - 1];
  const working = !!last?.run && OPEN.includes(last.run.status);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);

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

  async function send() {
    const message = input.trim();
    if (!message || working) return;
    if (isLocked) {
      openUpgrade();
      return;
    }
    const answerKey = `answer-${Date.now()}`;
    setInput('');
    setTurns((all) => [
      ...all,
      { key: `you-${Date.now()}`, role: 'user', text: message },
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
        brandId: conversationId ? undefined : (activeBrandId ?? undefined),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      const body = (await res?.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      setTurns((all) => all.filter((turn) => turn.key !== answerKey));
      setInput(message);
      if (body?.code === 'subscription_inactive') openUpgrade();
      else toast.error(body?.error ?? t('sendFailed'));
      return;
    }
    const chatId = res.headers.get('x-chat-conversation');
    const runId = res.headers.get('x-chat-run');
    if (chatId && !conversationId) {
      setConversationId(chatId);
      window.history.replaceState(null, '', `${window.location.pathname}/${chatId}`);
    }
    updateRun(answerKey, (turn) => ({ ...turn, runId }));
    if (runId) await consume(answerKey, res.body, runId);
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

  async function stop() {
    if (!last?.runId) return;
    await fetch(`/api/chat/runs/${last.runId}/stop`, { method: 'POST' }).catch(() => null);
    // A run nothing drives (queued, waiting) is ended by the Stop itself: its events say so.
    if (last.run && last.run.status !== 'running') {
      const res = await fetch(`/api/chat/runs/${last.runId}/events?after=${last.run.lastSeq}`);
      if (res.ok && res.body) await consume(last.key, res.body, last.runId);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link href="/dashboard/chat" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('newChat')}
        </Link>
      </header>

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
            <li key={turn.key} className="flex flex-col gap-3">
              <AnswerView
                turn={turn}
                now={now}
                reconnecting={reconnecting && turn === last}
                onApprove={(dontAskAgain) => answer(turn, 'approve', dontAskAgain)}
                onSkip={() => answer(turn, 'skip')}
              />
            </li>
          ),
        )}
      </ol>

      <form
        className="sticky bottom-0 flex flex-col gap-2 rounded-xl border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={t('placeholder')}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('modeLabel')}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`modes.${m}`)}
                </option>
              ))}
            </select>
          </label>
          {working ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void stop()}>
              {t('stop')}
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!input.trim()}>
              {t('send')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function AnswerView({
  turn,
  now,
  reconnecting,
  onApprove,
  onSkip,
}: {
  turn: Turn;
  now: number;
  reconnecting: boolean;
  onApprove: (dontAskAgain: boolean) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const t = useTranslations('chatPage');
  const run = turn.run ?? emptyRun('done');
  const workingMs = run.summary?.workingMs ?? (turn.startedAt ? now - turn.startedAt : 0);
  const confirmStep = run.confirm ? run.steps.find((s) => s.n === run.confirm!.n) : undefined;
  const timeZone = turn.timezone ?? undefined;

  return (
    <>
      <RunSteps
        status={stepsStatus(run.status)}
        steps={run.steps}
        workingMs={workingMs}
        sources={run.summary?.sources.length ?? 0}
      />
      {run.status === 'queued' && run.steps.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('queued')}</p>
      )}
      {reconnecting && <p className="text-sm text-muted-foreground">{t('reconnecting')}</p>}
      {run.text && (
        <div className="text-sm">
          <Markdown>{run.text}</Markdown>
        </div>
      )}
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
      {run.status === 'stopped' && <p className="text-sm text-muted-foreground">{t('stopped')}</p>}
      {run.status === 'paused_cap' && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{t('pausedCap')}</p>
      )}
      {run.status === 'error' && run.errorReason && (
        <p className="text-sm text-red-700 dark:text-red-400">{run.errorReason}</p>
      )}
      {run.generatedAt && (
        <p className={cn('text-xs text-muted-foreground')}>
          {(() => {
            const at = stampParts(run.generatedAt, timeZone);
            const generated = t('generated', { date: `${at.date} · ${at.time}` });
            if (!run.dataAsOf) return generated;
            const asOf = stampParts(run.dataAsOf, timeZone);
            return `${generated} · ${t('dataAsOf', { date: `${asOf.date} · ${asOf.time}` })}`;
          })()}
        </p>
      )}
    </>
  );
}
