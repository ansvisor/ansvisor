// @vitest-environment node
import { tool, type ModelMessage, type SystemModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { THINKING_TAG, replayFrame, replayableThinking, tagThinking } from './thinking-replay';

/**
 * Preserved thinking (Claude Fable 5.2): a thinking block goes back only on
 * what it was made on, and the ones left out are a run from the front.
 */

const MARK = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
const SYSTEM: SystemModelMessage[] = [
  { role: 'system', content: 'Core rules.', providerOptions: MARK },
  { role: 'system', content: 'The workspace.' },
];
const TOOLS = {
  read_visibility: tool({ description: 'A read.', inputSchema: z.object({ brand: z.string() }) }),
  ask_question: tool({ description: 'A question.', inputSchema: z.object({ q: z.string() }) }),
};
const TURN: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'Why did it fall?' }] };

/** A reply as the SDK returns it: a thinking block with its signature, then a tool call. */
const reply = (n: number): ModelMessage => ({
  role: 'assistant',
  content: [
    { type: 'reasoning', text: '', providerOptions: { anthropic: { signature: `sig-${n}` } } },
    { type: 'text', text: ' ' },
    { type: 'tool-call', toolCallId: `c${n}`, toolName: 'read_visibility', input: { brand: 'b' } },
  ],
});
const results = (n: number): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: `c${n}`,
      toolName: 'read_visibility',
      output: { type: 'json', value: { rows: n, at: { b: 1, a: 2 } } },
    },
  ],
});
const signatures = (messages: ModelMessage[]) =>
  messages.flatMap((m) =>
    typeof m.content === 'string'
      ? []
      : m.content
          .filter((p) => p.type === 'reasoning')
          .map((p) => (p.providerOptions?.anthropic as { signature: string }).signature),
  );

/** Runs `n` steps of a tool loop as the engine does: send, tag the reply, append it and its results. */
async function loop(n: number, system = SYSTEM, tools: typeof TOOLS = TOOLS) {
  const frame = await replayFrame(system, tools);
  let history: ModelMessage[] = [TURN];
  for (let i = 1; i <= n; i++) {
    const sent = replayableThinking(frame, history).messages;
    history = [...history, ...tagThinking(frame, sent, [reply(i)]), results(i)];
  }
  return history;
}

describe('thinking-replay', () => {
  it('tags each block with what it was made on, in a namespace no provider reads', async () => {
    const [, tagged] = await loop(1);
    const thinking = (tagged.content as { providerOptions?: Record<string, unknown> }[])[0];
    expect(thinking.providerOptions).toMatchObject({
      anthropic: { signature: 'sig-1' },
      [THINKING_TAG]: { prefix: expect.any(String) },
    });
  });

  it('sends every block back while nothing before it changed, cache marks moved or not', async () => {
    const history = await loop(3);
    const frame = await replayFrame(SYSTEM, TOOLS);
    const marked = history.map((m, i) =>
      i === history.length - 1 ? { ...m, providerOptions: MARK } : m,
    );
    const out = replayableThinking(frame, marked);
    expect(out.dropped).toBe(0);
    expect(signatures(out.messages)).toEqual(['sig-1', 'sig-2', 'sig-3']);
    // The same tools in another order are the same set.
    const reordered = await replayFrame(SYSTEM, {
      ask_question: TOOLS.ask_question,
      read_visibility: TOOLS.read_visibility,
    });
    expect(replayableThinking(reordered, history).dropped).toBe(0);
  });

  it('keeps them through a store that reorders keys and drops blank text', async () => {
    const history = await loop(2);
    // A JSONB round trip: keys come back in its own order.
    const stored = JSON.parse(JSON.stringify(history), (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ) as ModelMessage[];
    const blankless = stored.map((m) =>
      m.role === 'assistant' && typeof m.content !== 'string'
        ? { ...m, content: m.content.filter((p) => p.type !== 'text' || p.text.trim()) }
        : m,
    ) as ModelMessage[];
    const out = replayableThinking(await replayFrame(SYSTEM, TOOLS), blankless);
    expect(out.dropped).toBe(0);
  });

  it('leaves every block out once the system prompt or the tools change', async () => {
    const history = await loop(3);
    const skill: SystemModelMessage = { role: 'system', content: '<skill name="faq">…</skill>' };
    const prompt = replayableThinking(await replayFrame([...SYSTEM, skill], TOOLS), history);
    expect(prompt.dropped).toBe(3);
    expect(signatures(prompt.messages)).toEqual([]);
    const fewer = { read_visibility: TOOLS.read_visibility };
    const tools = replayableThinking(await replayFrame(SYSTEM, fewer), history);
    expect(signatures(tools.messages)).toEqual([]);
    // The rest of the history is as it was: only the thinking blocks are left out.
    expect(tools.messages.map((m) => m.role)).toEqual(history.map((m) => m.role));
  });

  it('leaves out a leading run, up to the last block whose prefix changed', async () => {
    const history = await loop(3);
    // The first tool result rewritten: blocks 2 and 3 were made on it, block 1 before it.
    const edited = history.map((m, i) => (i === 2 ? results(99) : m));
    const out = replayableThinking(await replayFrame(SYSTEM, TOOLS), edited);
    // Block 1 sits before the edit but goes with the others: what's left out is a run from the front.
    expect(out.dropped).toBe(3);
    // A block the history only gained after the edit is kept, and the ones before it stay out.
    const frame = await replayFrame(SYSTEM, TOOLS);
    const sent = replayableThinking(frame, edited).messages;
    const grown = [...edited, ...tagThinking(frame, sent, [reply(4)]), results(4)];
    const next = replayableThinking(frame, grown);
    expect(signatures(next.messages)).toEqual(['sig-4']);
    expect(next.dropped).toBe(3);
  });

  it('never brings back a block left out while a later one was made', async () => {
    const frame = await replayFrame(SYSTEM, TOOLS);
    const skill: SystemModelMessage = { role: 'system', content: 'A skill.' };
    const other = await replayFrame([...SYSTEM, skill], TOOLS);
    // Step 1 on the first prompt, step 2 on the second (block 1 left out), then the first again.
    let history: ModelMessage[] = [TURN];
    history = [...history, ...tagThinking(frame, history, [reply(1)]), results(1)];
    const sent = replayableThinking(other, history).messages;
    expect(signatures(sent)).toEqual([]);
    history = [...history, ...tagThinking(other, sent, [reply(2)]), results(2)];
    // Back on the first prompt: block 1 would fit again, but block 2 was made without it.
    const back = replayableThinking(frame, history);
    expect(signatures(back.messages)).toEqual([]);
  });

  it('leaves out a block it has no digest for (another model’s, or one made before the rule)', async () => {
    const history = [TURN, reply(1), results(1)];
    const out = replayableThinking(await replayFrame(SYSTEM, TOOLS), history);
    expect(out.dropped).toBe(1);
    expect(signatures(out.messages)).toEqual([]);
  });
});
