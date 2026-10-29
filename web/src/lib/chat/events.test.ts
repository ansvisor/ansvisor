// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHAT_EVENT_TYPES,
  CHAT_STEP_KINDS,
  chatEvent,
  clientEventProblems,
  isChatEventType,
  type ChatDeliverable,
  type ChatEvent,
  type ChatEventPayloads,
  type ChatEventType,
  type ChatStep,
} from './events';

/**
 * Chat's streamed events: one of every type goes to the browser, and none of
 * them can carry a tool's name, a debug record, an id or a dollar amount.
 */

const UUID = '7d3f2c1a-9b8e-4c6d-a5f4-3e2d1c0b9a87';

const STEP: ChatStep = {
  n: 2,
  kind: 'read',
  status: 'done',
  label: 'Read Citations',
  detail: 'Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows',
  scope: {
    subject: 'Pricing prompts',
    dateRange: 'Last 30 days',
    platforms: ['ChatGPT', 'Perplexity'],
  },
  rowCount: 42,
  dataAsOf: '2026-10-29T06:00:00.000Z',
};

const SUMMARY = {
  workingMs: 72_000,
  stepCount: 7,
  sources: [
    { label: 'Citations', count: 42 },
    { label: 'Prompts', count: 12 },
  ],
};

const DELIVERABLE: ChatDeliverable = {
  title: 'Pricing FAQ',
  type: 'document',
  formats: ['md', 'docx'],
  status: 'draft',
};

/** One of every type, as the stream would send it. */
const SAMPLES: { [K in ChatEventType]: () => Extract<ChatEvent, { type: K }> } = {
  'step.started': () => chatEvent('step.started', 1, { step: { ...STEP, status: 'running' } }),
  'step.updated': () => chatEvent('step.updated', 2, { step: { ...STEP, status: 'running' } }),
  'step.finished': () => chatEvent('step.finished', 3, { step: STEP }),
  'text.delta': () => chatEvent('text.delta', 4, { text: 'Citations on Perplexity fell **18%**' }),
  'ask.created': () =>
    chatEvent('ask.created', 5, {
      n: 3,
      question: 'Which pages should I check?',
      options: [
        { label: '/pricing', detail: 'Lost 6 citations', recommended: true },
        { label: 'Generate an image', costMultiplier: 2 },
      ],
      allowOther: true,
      multi: false,
    }),
  'deliverable.created': () => chatEvent('deliverable.created', 6, DELIVERABLE),
  'confirm.required': () =>
    chatEvent('confirm.required', 7, {
      n: 4,
      action: 'Add 12 prompts to tracking',
      target: 'Pricing · Northwind CRM',
    }),
  next_moves: () =>
    chatEvent('next_moves', 8, {
      moves: [{ label: 'Turn this into actions', prompt: 'Turn these findings into actions' }],
    }),
  'usage.updated': () => chatEvent('usage.updated', 9, { percentUsed: 44, runPercent: 0.3 }),
  'run.finished': () =>
    chatEvent('run.finished', 10, {
      ...SUMMARY,
      generatedAt: '2026-10-29T09:14:00.000Z',
      dataAsOf: '2026-10-29T06:00:00.000Z',
    }),
  'run.error': () => chatEvent('run.error', 11, { ...SUMMARY, code: 'timeout' }),
  'run.paused_cap': () => chatEvent('run.paused_cap', 12, SUMMARY),
  'deliverable.updated': () => chatEvent('deliverable.updated', 13, { ...DELIVERABLE, version: 2 }),
  'suggestion.created': () => chatEvent('suggestion.created', 14, { count: 3 }),
  'suggestion.resolved': () => chatEvent('suggestion.resolved', 15, { count: 1 }),
  'page.opened': () => chatEvent('page.opened', 16, { where: 'here' }),
};

/** Every key in a type, at any depth. */
type KeysDeep<T> = T extends readonly (infer U)[]
  ? KeysDeep<U>
  : T extends object
    ? { [K in keyof T]-?: K | KeysDeep<T[K]> }[keyof T]
    : never;

/** The keys no payload may have. */
type ForbiddenKey =
  | 'tool'
  | 'tools'
  | 'toolName'
  | 'tool_name'
  | 'debug'
  | 'debugJson'
  | 'debug_json'
  | 'input'
  | 'output'
  | 'id'
  | `${string}Id`
  | `${string}Ids`
  | `${string}_id`
  | `${string}_ids`
  | `${string}Usd`
  | `${string}_usd`;

describe('chat events', () => {
  it('lists every type once, and builds each one for the browser', () => {
    expect([...CHAT_EVENT_TYPES].sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const type of CHAT_EVENT_TYPES) {
      const event = SAMPLES[type]();
      expect(event.type).toBe(type);
      expect(clientEventProblems(event)).toEqual([]);
    }
  });

  it('sends no tool, debug, id or dollar field and no uuid in any of them', () => {
    const wire = JSON.stringify(CHAT_EVENT_TYPES.map((type) => SAMPLES[type]()));
    expect(wire).not.toMatch(/"(tools?|tool_?[nN]ame|debug(_?[jJ]son)?|input|output)"/);
    expect(wire).not.toMatch(/"(\w*_ids?|\w*[a-z]Ids?|ids?)":/);
    expect(wire).not.toMatch(/usd/i);
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('has no tool, debug, id or dollar key in any payload type', () => {
    type PayloadKey = KeysDeep<ChatEventPayloads[ChatEventType]>;
    expectTypeOf<Extract<PayloadKey, ForbiddenKey>>().toBeNever();
  });

  it("refuses a tool's name, even when the types are got around", () => {
    expect(() =>
      chatEvent('step.started', 1, {
        step: {
          n: 1,
          kind: 'read',
          status: 'running',
          label: 'Read Citations',
          // @ts-expect-error a step has no tool: the browser never gets one
          tool: 'list_citations',
        },
      }),
    ).toThrow(/event\.data\.step\.tool: a tool or debug field/);

    const loose = { ...STEP, toolName: 'get_prompt_performance' } as ChatStep;
    expect(() => chatEvent('step.finished', 2, { step: loose })).toThrow(/toolName/);
  });

  it('refuses a debug record, a tool input or output', () => {
    for (const key of ['debug_json', 'debugJson', 'input', 'output']) {
      const step = { ...STEP, [key]: { brand: 'Northwind' } } as ChatStep;
      expect(() => chatEvent('step.finished', 1, { step })).toThrow(`step.${key}`);
    }
  });

  it('refuses an id field, by any name', () => {
    for (const key of ['id', 'brandId', 'brand_id', 'promptIds', 'citation_ids']) {
      const step = { ...STEP, scope: { ...STEP.scope, [key]: 'x' } } as ChatStep;
      expect(() => chatEvent('step.finished', 1, { step })).toThrow(/an id field/);
    }
  });

  it('refuses a uuid in any text the browser shows', () => {
    expect(() =>
      chatEvent('step.finished', 1, { step: { ...STEP, label: `Read prompt ${UUID}` } }),
    ).toThrow(/event\.data\.step\.label: an id in the text/);
    expect(() =>
      chatEvent('step.finished', 1, {
        step: { ...STEP, scope: { platforms: ['ChatGPT', UUID.toUpperCase()] } },
      }),
    ).toThrow(/event\.data\.step\.scope\.platforms\[1\]/);
    expect(() =>
      chatEvent('confirm.required', 1, { n: 1, action: 'Archive 3 prompts', target: UUID }),
    ).toThrow(/event\.data\.target/);
  });

  it("leaves the answer's text to the engine, but not its keys", () => {
    expect(() => chatEvent('text.delta', 1, { text: `You asked about ${UUID}` })).not.toThrow();
    const text = { text: 'ok', brand_id: UUID } as { text: string };
    expect(() => chatEvent('text.delta', 1, text)).toThrow(/event\.data\.brand_id: an id field/);
  });

  it('refuses a dollar amount: usage is a percent of the monthly limit', () => {
    const usage = { percentUsed: 44, costUsd: 0.04 } as { percentUsed: number };
    expect(() => chatEvent('usage.updated', 1, usage)).toThrow(/costUsd: a dollar amount/);
  });

  it("knows its own types, so the browser can skip a newer server's", () => {
    expect(isChatEventType('step.started')).toBe(true);
    expect(isChatEventType('page.opened')).toBe(true);
    expect(isChatEventType('click.required')).toBe(false);
    expect(isChatEventType('toString')).toBe(false);
    expect(isChatEventType(undefined)).toBe(false);
  });
});

describe('step kinds', () => {
  it('match the kinds the migrations put in chat_step_kinds', () => {
    const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
    const seeded = new Set<string>();
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
      const inserts = sql.matchAll(
        /insert\s+into\s+(?:public\.)?chat_step_kinds\s*\(\s*kind\s*\)\s*values([^;]*);/gi,
      );
      for (const [, values] of inserts) {
        for (const [, kind] of values.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)) seeded.add(kind);
      }
    }
    expect([...seeded].sort()).toEqual([...CHAT_STEP_KINDS].sort());
  });
});
