import { createHash, type Hash } from 'node:crypto';
import { asSchema, type ModelMessage, type SystemModelMessage, type ToolSet } from 'ai';

/**
 * Claude's preserved thinking, for a model whose entry binds it (lib/chat/
 * models.ts `boundThinking`: Claude Fable 5.2). A thinking block the API
 * returns is valid only on the tools, the system prompt and every message
 * that came before it when it was made: a request that sends it back after
 * any of those changed is a 400 that a retry doesn't clear, on every
 * account. A run's steps aren't append-only: a skill loaded mid-run joins
 * the system prompt, the question card's and the next moves' tools come and
 * go, the turn message gains a note, and a run resumed after its card
 * renders its prompt again. So:
 *
 *   - tagThinking marks each thinking block of a step's reply with a digest
 *     of what came before it in the request that made it: the tools by
 *     name, the system prompt, the messages and the reply's own parts before
 *     it (never a thinking block, a cache mark or blank text, which the API
 *     doesn't compare either);
 *   - replayableThinking works the same digest out for each block as the
 *     next request stands, and leaves out every block up to the last one
 *     whose digest changed (or that has none).
 *
 * What it leaves out is a leading run of blocks, oldest first: the shape the
 * API accepts for a history that drops thinking. What it keeps sits on
 * exactly what it was made on, and so do the blocks before it: a block left
 * out while a later one was made never comes back, as that later block's
 * prefix holds what changed and stops matching first. Leaving a block out
 * costs that reasoning (the model thinks again), never the request. No beta
 * header: the check stays at its default, a 400, which a block sent here
 * doesn't meet. Server only (node:crypto).
 */

/** The providerOptions namespace the digest is kept under: no provider reads it. */
export const THINKING_TAG = 'ansvisor';

/** What every step's messages come after: the tools and the system prompt, hashed. */
export interface ReplayFrame {
  readonly head: Hash;
}

type Part = { type: string; text?: string; providerOptions?: unknown } & Record<string, unknown>;

/** A value with its keys sorted, bytes as base64 and no undefined: the same JSON for the same data. */
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? String(value) : value;
  }
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('base64') };
  if (value instanceof ArrayBuffer) return { bytes: Buffer.from(value).toString('base64') };
  if (value instanceof URL) return { url: value.href };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : canonical(item)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined || typeof item === 'function') continue;
    out[key] = canonical(item);
  }
  return out;
}

/** A part's or a message's provider options without a cache mark or this module's tag. */
function optionsOf(options: unknown): unknown {
  if (!options || typeof options !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [provider, value] of Object.entries(options)) {
    if (provider === THINKING_TAG) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rest = { ...(value as Record<string, unknown>) };
      delete rest.cacheControl;
      delete rest.cache_control;
      if (Object.keys(rest).length > 0) out[provider] = rest;
    } else if (value !== undefined) out[provider] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const feed = (hash: Hash, value: unknown) => hash.update(`${JSON.stringify(canonical(value))}\n`);

/** A message's parts: string content is one text part, as the API reads it. */
const partsOf = (content: ModelMessage['content'] | SystemModelMessage['content']): Part[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : (content as unknown as Part[]);

const isThinking = (part: Part) => part.type === 'reasoning';
/** Blank text: the API turns an empty text block away and ignores a blank one's place. */
const isBlank = (part: Part) => part.type === 'text' && !(part.text ?? '').trim();

/** A part as the digest reads it: its fields, its options without a cache mark. */
const partOf = (part: Part) => ({ ...part, providerOptions: optionsOf(part.providerOptions) });

/**
 * Walks messages after `hash`, feeding every part but thinking, and calls
 * `onThinking` at each thinking block with the digest of what came before it.
 */
function walk(
  hash: Hash,
  messages: readonly ModelMessage[],
  onThinking: (digest: string, at: { message: number; part: number }) => void,
): void {
  messages.forEach((message, m) => {
    feed(hash, { role: message.role, providerOptions: optionsOf(message.providerOptions) });
    partsOf(message.content).forEach((part, p) => {
      if (isThinking(part)) onThinking(hash.copy().digest('base64url'), { message: m, part: p });
      else if (!isBlank(part)) feed(hash, partOf(part));
    });
  });
}

/** A thinking block's digest, as tagThinking kept it; null when it has none. */
function tagOf(part: Part): string | null {
  const options = part.providerOptions as Record<string, { prefix?: unknown }> | undefined;
  const prefix = options?.[THINKING_TAG]?.prefix;
  return typeof prefix === 'string' ? prefix : null;
}

/**
 * The tools, by name (the API compares them as a set), and the system
 * prompt, hashed once a step. A tool's input schema as the SDK sends it.
 */
export async function replayFrame(
  system: readonly SystemModelMessage[],
  tools: ToolSet | undefined,
): Promise<ReplayFrame> {
  const head = createHash('sha256');
  for (const name of Object.keys(tools ?? {}).sort()) {
    const tool = tools![name] as {
      type?: string;
      description?: string;
      inputSchema?: unknown;
      providerOptions?: unknown;
    };
    const schema = tool.inputSchema
      ? await asSchema(tool.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema
      : null;
    feed(head, {
      tool: name,
      type: tool.type ?? 'function',
      description: tool.description ?? null,
      inputSchema: schema,
      providerOptions: optionsOf(tool.providerOptions),
    });
  }
  for (const block of system) {
    feed(head, {
      system: partsOf(block.content)
        .filter((part) => !isBlank(part))
        .map(partOf),
      providerOptions: optionsOf(block.providerOptions),
    });
  }
  return { head };
}

/**
 * A step's messages with the thinking blocks it may send back: every block
 * after the last one whose digest changed since it was made (or that has
 * none) goes back as it came; the ones up to it are left out. `dropped`:
 * how many were left out.
 */
export function replayableThinking(
  frame: ReplayFrame,
  messages: readonly ModelMessage[],
): { messages: ModelMessage[]; dropped: number } {
  const blocks: { message: number; part: number }[] = [];
  let last = -1;
  walk(frame.head.copy(), messages, (digest, at) => {
    const part = partsOf(messages[at.message].content)[at.part];
    if (tagOf(part) !== digest) last = blocks.length;
    blocks.push(at);
  });
  if (last < 0) return { messages: [...messages], dropped: 0 };
  const out = new Map<number, Set<number>>();
  for (const at of blocks.slice(0, last + 1)) {
    out.set(at.message, (out.get(at.message) ?? new Set()).add(at.part));
  }
  return {
    messages: messages.map((message, m) => {
      const parts = out.get(m);
      if (!parts || typeof message.content === 'string') return message;
      return {
        ...message,
        content: message.content.filter((_, p) => !parts.has(p)),
      } as ModelMessage;
    }),
    dropped: last + 1,
  };
}

/**
 * A step's reply with each thinking block marked with the digest of what
 * came before it: the request as it was sent (`sent`, after the frame), then
 * the reply's own parts before it.
 */
export function tagThinking(
  frame: ReplayFrame,
  sent: readonly ModelMessage[],
  reply: readonly ModelMessage[],
): ModelMessage[] {
  const hash = frame.head.copy();
  walk(hash, sent, () => {});
  const digests = new Map<string, string>();
  walk(hash, reply, (digest, at) => digests.set(`${at.message}:${at.part}`, digest));
  if (digests.size === 0) return [...reply];
  return reply.map((message, m) => {
    if (typeof message.content === 'string') return message;
    const content = (message.content as unknown as Part[]).map((part, p) => {
      const digest = digests.get(`${m}:${p}`);
      if (!digest) return part;
      const options = (part.providerOptions ?? {}) as Record<string, unknown>;
      return { ...part, providerOptions: { ...options, [THINKING_TAG]: { prefix: digest } } };
    });
    return { ...message, content } as ModelMessage;
  });
}
