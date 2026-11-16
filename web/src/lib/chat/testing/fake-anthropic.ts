import { createHash } from 'node:crypto';

/**
 * Anthropic's Messages API as a test's `fetch` (createAnthropic's): each
 * request's body is kept as it went over the wire, and each answer is a
 * scripted reply streamed back as the API streams it, opening with a
 * thinking block (empty text and a signature, as Claude Fable 5.2's
 * default "omitted" display returns it).
 *
 * It checks preserved thinking as the API does on Claude Fable 5.2, for
 * every account: a thinking block sent back must sit on the same tools (as
 * a set), system prompt and messages before it as when it was made (cache
 * marks, blank text and thinking blocks aside), and the blocks sent back
 * must be a run of the ones made, from the front: a block may come first
 * without the one before it, never after a gap. A request that breaks
 * either is a 400 "bound to a different conversation". Tests only.
 */

/** One scripted reply. */
export interface FakeReply {
  /** Its text, after the thinking block. */
  text?: string;
  /** Its tool calls, after the text. */
  tools?: { id: string; name: string; input: Record<string, unknown> }[];
  /** "refusal": the classifiers turned it down (after any text). */
  stop?: 'end_turn' | 'tool_use' | 'refusal';
  /** An error answer instead: its status and message. */
  error?: { status: number; type: string; message: string };
}

type Block = { type: string; text?: string; signature?: string } & Record<string, unknown>;
type WireMessage = { role: string; content: string | Block[] };
export interface WireBody {
  model: string;
  system?: Block[];
  tools?: ({ name: string } & Record<string, unknown>)[];
  messages: WireMessage[];
  [key: string]: unknown;
}

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
};
const withoutMark = (block: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'cache_control'));
const blocksOf = (content: WireMessage['content']): Block[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : content;
const compared = (block: Block) =>
  block.type !== 'thinking' &&
  block.type !== 'redacted_thinking' &&
  !(block.type === 'text' && !(block.text ?? '').trim());

/** What the check compares before message `m`'s block `b`: the tools, the system, the messages. */
function prefixOf(body: WireBody, m: number, b: number): string {
  const tools = [...(body.tools ?? [])]
    .sort((x, y) => x.name.localeCompare(y.name))
    .map(withoutMark);
  const system = (body.system ?? []).filter(compared).map(withoutMark);
  const messages = body.messages.slice(0, m + 1).map((message, i) => ({
    role: message.role,
    content: blocksOf(message.content)
      .slice(0, i === m ? b : undefined)
      .filter(compared)
      .map(withoutMark),
  }));
  return createHash('sha256')
    .update(JSON.stringify(sorted({ tools, system, messages })))
    .digest('hex');
}

const sse = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

export function fakeAnthropic(replies: FakeReply[]) {
  const bodies: WireBody[] = [];
  /** The 400s the check gave, in order. */
  const rejected: string[] = [];
  /** Each signature made: what it was made on, and the block before it then. */
  const made = new Map<string, { prefix: string; before: string | null }>();
  let signatures = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const invalid = (message: string) => {
    rejected.push(message);
    return json(400, { type: 'error', error: { type: 'invalid_request_error', message } });
  };

  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as WireBody;
    bodies.push(body);
    // Preserved thinking: every block sent back on what it was made on, a run from the front.
    let previous: string | null = null;
    for (const [m, message] of body.messages.entries()) {
      for (const [b, block] of blocksOf(message.content).entries()) {
        if (block.type !== 'thinking') continue;
        const known = made.get(String(block.signature));
        if (!known) return invalid(`messages.${m}.content.${b}: Invalid \`signature\`.`);
        const gap = previous !== null && known.before !== previous;
        if (known.prefix !== prefixOf(body, m, b) || gap) {
          return invalid(
            `messages.${m}.content.${b}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation.`,
          );
        }
        previous = String(block.signature);
      }
    }
    const reply = replies.shift();
    if (!reply) throw new Error('the fake Anthropic API has no more replies');
    if (reply.error) {
      return json(reply.error.status, {
        type: 'error',
        error: { type: reply.error.type, message: reply.error.message },
      });
    }
    const signature = `sig-${++signatures}`;
    made.set(signature, {
      prefix: prefixOf(
        { ...body, messages: [...body.messages, { role: 'assistant', content: [] }] },
        body.messages.length,
        0,
      ),
      before: previous,
    });
    const events: Record<string, unknown>[] = [
      {
        type: 'message_start',
        message: {
          id: `msg_${signatures}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 1 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } },
      { type: 'content_block_stop', index: 0 },
    ];
    let index = 1;
    if (reply.text) {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: reply.text } },
        { type: 'content_block_stop', index },
      );
      index += 1;
    }
    for (const tool of reply.tools ?? []) {
      events.push(
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) },
        },
        { type: 'content_block_stop', index },
      );
      index += 1;
    }
    const stop = reply.stop ?? (reply.tools?.length ? 'tool_use' : 'end_turn');
    events.push(
      {
        type: 'message_delta',
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 20 },
      },
      { type: 'message_stop' },
    );
    return new Response(events.map(sse).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  return { fetch: fetch as typeof globalThis.fetch, bodies, rejected };
}
