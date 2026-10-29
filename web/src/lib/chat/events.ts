/**
 * The events a Chat run streams to the browser (CHAT-00 "Streaming events",
 * CHAT-03, CHAT-25 §12). One run writes one answer; the browser draws its
 * steps, text, cards and end from these events only.
 *
 * What a customer's browser never gets (CHAT-00 principle 3, CHAT-03 items
 * 22–23, DECISIONS R), held twice: by the payload types below, which have no
 * field for any of it, and by chatEvent(), which every event the stream sends
 * goes through and which refuses
 *   - a tool's name, its input or output, or a debug record;
 *   - an id: no `id`, `…Id` or `…_id` key, and no uuid in any text;
 *   - a dollar amount: usage is a percent of the monthly AI limit.
 * A step is named by its place in the run (`n`, from 1), which is also how a
 * question or an approval points at its step; a reconnect resumes after the
 * last event's `seq`.
 *
 * Adding an event is one entry in ChatEventPayloads and one in EVENT_TYPES
 * (the compiler asks for both). The browser skips a type it doesn't know
 * (isChatEventType), so a newer server never breaks an open page.
 */

// ─── Steps ──────────────────────────────────────────────────────────────────

/**
 * What a step does (CHAT-03 "Labels by kind"; `execute`, CHAT-03 v2, waits on
 * the person's click). The database lists the same kinds in chat_step_kinds
 * (00400); a new kind goes in both.
 */
export const CHAT_STEP_KINDS = [
  'thinking',
  'read',
  'open_page',
  'skill',
  'check',
  'write',
  'ask',
  'schedule',
  'image',
  'execute',
] as const;
export type ChatStepKind = (typeof CHAT_STEP_KINDS)[number];

/** pending: in a plan, not started; waiting: on the person (chat_run_steps.status). */
export type ChatStepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'error' | 'skipped';

/** What a read covered, in the app's words: never ids (CHAT-03 item 5). */
export interface ChatStepScope {
  /** "Pricing prompts" */
  subject?: string;
  /** "Last 30 days", "1–15 Oct", "All time" */
  dateRange?: string;
  /** Display names: "ChatGPT", "Perplexity". */
  platforms?: string[];
  /** Only when the read isn't for the chat's brand. */
  brand?: string;
}

/** A step as the browser sees it: the label registry's words, never the tool. */
export interface ChatStep {
  /** Its place in the run, from 1. */
  n: number;
  kind: ChatStepKind;
  status: ChatStepStatus;
  /** "Read Citations" */
  label: string;
  /** "Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows", or an error's plain reason. */
  detail?: string;
  scope?: ChatStepScope;
  rowCount?: number;
  /** The newest data the read used, ISO (CHAT-20 §15a). */
  dataAsOf?: string;
}

// ─── Cards ──────────────────────────────────────────────────────────────────

/** One choice on a question card (CHAT-00 `ask`, CHAT-07). */
export interface ChatAskOption {
  label: string;
  detail?: string;
  recommended?: boolean;
  /** A model's multiplier against Auto (1, 2, 4): never a price. */
  costMultiplier?: number;
}

/** A question card; the run waits on it (CHAT-07). */
export interface ChatAsk {
  /** The step that waits for the answer. */
  n: number;
  question: string;
  options: ChatAskOption[];
  allowOther: boolean;
  multi: boolean;
}

/**
 * A change waiting for the person's OK (CHAT-00 `confirm.required`). The
 * spec's "tool" is the action in words here: the browser never gets a
 * tool's name.
 */
export interface ChatConfirm {
  /** The step that waits for the OK. */
  n: number;
  /** "Add 12 prompts to tracking" */
  action: string;
  /** "Pricing · Northwind CRM" */
  target: string;
}

/** What Chat made (CHAT-00 `file`, CHAT-06). */
export interface ChatDeliverable {
  title: string;
  type: 'document' | 'table' | 'code' | 'image' | 'report';
  /** "md", "docx", "pdf", "csv", "xlsx"… */
  formats: string[];
  status: 'draft' | 'attached' | 'done';
}

/** A next move: a chip that fills the composer (CHAT-07). In rank order. */
export interface ChatNextMove {
  label: string;
  prompt: string;
}

/** The workspace's monthly AI usage, as a percent of its limit (CHAT-04, DECISIONS R). */
export interface ChatUsage {
  percentUsed: number;
  /** This run's share of the monthly limit. */
  runPercent?: number;
}

/** A run's end, for the collapsed step header (CHAT-03 items 9–12). */
export interface ChatRunSummary {
  workingMs: number;
  stepCount: number;
  /** The "Data used" chips: "Citations · 42". */
  sources: { label: string; count: number }[];
}

/** Where a page Chat writes was opened (CHAT-25 §3). */
export type ChatPageWhere = 'chat' | 'here' | 'editor';

// ─── Events ─────────────────────────────────────────────────────────────────

/** Each event's payload, by type. */
export interface ChatEventPayloads {
  'step.started': { step: ChatStep };
  'step.updated': { step: ChatStep };
  'step.finished': { step: ChatStep };
  /** A chunk of the answer's markdown. */
  'text.delta': { text: string };
  'ask.created': ChatAsk;
  'deliverable.created': ChatDeliverable;
  'confirm.required': ChatConfirm;
  next_moves: { moves: ChatNextMove[] };
  'usage.updated': ChatUsage;
  /** generatedAt and dataAsOf: the answer's "Generated …" and "Data as of …" (CHAT-06 38–39). */
  'run.finished': ChatRunSummary & { generatedAt: string; dataAsOf: string | null };
  /** code: a standard result code (CHAT-20 §11a); the browser shows its words. */
  'run.error': ChatRunSummary & { code: 'failed' | 'timeout' };
  'run.paused_cap': ChatRunSummary;
  // Editor in Chat (CHAT-25 §12, Phase 4): payloads grow with it.
  /** A new version card of a page Chat writes. */
  'deliverable.updated': ChatDeliverable & { version: number };
  /** Suggestions Chat made on the open page, for the editor to show. */
  'suggestion.created': { count: number };
  'suggestion.resolved': { count: number };
  'page.opened': { where: ChatPageWhere };
}

export type ChatEventType = keyof ChatEventPayloads;

/** One event on the wire: `seq` counts up within the run, from 1. */
export type ChatEvent = {
  [K in ChatEventType]: { type: K; seq: number; data: ChatEventPayloads[K] };
}[ChatEventType];

/** Every type, once: a type missing here, or one that doesn't exist, doesn't compile. */
const EVENT_TYPES: Record<ChatEventType, true> = {
  'step.started': true,
  'step.updated': true,
  'step.finished': true,
  'text.delta': true,
  'ask.created': true,
  'deliverable.created': true,
  'confirm.required': true,
  next_moves: true,
  'usage.updated': true,
  'run.finished': true,
  'run.error': true,
  'run.paused_cap': true,
  'deliverable.updated': true,
  'suggestion.created': true,
  'suggestion.resolved': true,
  'page.opened': true,
};

export const CHAT_EVENT_TYPES = Object.keys(EVENT_TYPES) as ChatEventType[];

/** Whether the browser knows this type; it skips one it doesn't. */
export function isChatEventType(type: unknown): type is ChatEventType {
  return typeof type === 'string' && Object.hasOwn(EVENT_TYPES, type);
}

// ─── What never goes to the browser ─────────────────────────────────────────

/** A tool, its input or output, or a debug record. */
const TOOL_OR_DEBUG_KEYS = new Set([
  'tool',
  'tools',
  'toolName',
  'tool_name',
  'toolCall',
  'tool_call',
  'debug',
  'debugJson',
  'debug_json',
  'input',
  'output',
  'args',
  'arguments',
]);

/** An id: `id`, `ids`, `brandId`, `brand_id`, `promptIds`… */
const ID_KEY = /^ids?$|_ids?$|[a-z0-9]Ids?$/;

/** A dollar amount: `usd`, `costUsd`, `cost_usd`… (DECISIONS R). */
const DOLLAR_KEY = /usd/i;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Why this event can't go to a customer's browser: every tool, debug, id or
 * dollar key and every uuid in it, by path. Empty when it can.
 *
 * The answer's own text (`text.delta`) isn't searched for uuids: it is the
 * model's words, which may quote what the person wrote, and a uuid can be
 * split across two chunks, so a chunk can't tell. Keeping ids out of the
 * answer is the engine's, on the whole text.
 */
export function clientEventProblems(event: ChatEvent): string[] {
  const problems: string[] = [];
  const answerText = event.type === 'text.delta' ? 'event.data.text' : null;
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (path !== answerText && UUID.test(value)) problems.push(`${path}: an id in the text`);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const at = `${path}.${key}`;
        if (TOOL_OR_DEBUG_KEYS.has(key)) problems.push(`${at}: a tool or debug field`);
        else if (ID_KEY.test(key)) problems.push(`${at}: an id field`);
        else if (DOLLAR_KEY.test(key)) problems.push(`${at}: a dollar amount`);
        walk(item, at);
      }
    }
  };
  walk(event, 'event');
  return problems;
}

/**
 * An event for the stream to send, checked: throws on anything
 * clientEventProblems finds, so a tool's name or an id never reaches a
 * customer's browser, even from a payload built loosely.
 */
export function chatEvent<K extends ChatEventType>(
  type: K,
  seq: number,
  data: ChatEventPayloads[K],
): Extract<ChatEvent, { type: K }> {
  const event = { type, seq, data } as Extract<ChatEvent, { type: K }>;
  const problems = clientEventProblems(event);
  if (problems.length > 0) {
    throw new Error(`Chat event "${type}" can't go to the browser: ${problems.join('; ')}`);
  }
  return event;
}
