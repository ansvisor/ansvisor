import { describe, expect, it } from 'vitest';
import type { ChatStep } from '@/lib/chat/events';
import { dataUsed, doneSteps, listedSteps, statusLine, stepsSummary } from './run-view';

/** What an answer shows of its steps: the live line, the steps line and Data used (W1-14). */

const step = (over: Partial<ChatStep> & Pick<ChatStep, 'n' | 'kind' | 'label'>): ChatStep => ({
  status: 'done',
  ...over,
});

describe('statusLine', () => {
  it('says what the running step does, in its own words', () => {
    expect(
      statusLine([step({ n: 1, kind: 'read', label: 'Read Citations', status: 'running' })], false),
    ).toEqual({
      key: 'read',
      values: { source: 'Citations' },
    });
    expect(
      statusLine(
        [
          step({
            n: 1,
            kind: 'open_page',
            label: 'Opened ansvisor.com/pricing',
            status: 'running',
          }),
        ],
        false,
      ),
    ).toEqual({ key: 'openPage', values: { page: 'ansvisor.com/pricing' } });
    expect(
      statusLine([step({ n: 1, kind: 'check', label: 'Checked facts', status: 'running' })], true),
    ).toEqual({
      key: 'check',
    });
    expect(
      statusLine(
        [step({ n: 1, kind: 'write', label: 'Drafted FAQ block', status: 'running' })],
        false,
      ),
    ).toEqual({
      key: 'other',
      values: { label: 'Drafted FAQ block' },
    });
  });

  it('thinks without a running step, and writes while text streams', () => {
    expect(statusLine([], false)).toEqual({ key: 'thinking' });
    expect(statusLine([step({ n: 1, kind: 'read', label: 'Read Citations' })], true)).toEqual({
      key: 'writing',
    });
    expect(
      statusLine([step({ n: 1, kind: 'thinking', label: 'Thinking', status: 'running' })], false),
    ).toEqual({
      key: 'thinking',
    });
  });
});

describe('doneSteps and dataUsed', () => {
  const steps: ChatStep[] = [
    step({ n: 1, kind: 'thinking', label: 'Thinking' }),
    step({ n: 2, kind: 'read', label: 'Read Citations', rowCount: 18 }),
    step({ n: 3, kind: 'open_page', label: 'Opened ansvisor.com/pricing' }),
    step({ n: 4, kind: 'read', label: 'Read Citations', rowCount: 42 }),
    step({ n: 5, kind: 'skill', label: 'Used skill: FAQ + schema writer' }),
    step({ n: 6, kind: 'check', label: 'Checked facts', detail: 'Every figure matches the data' }),
    step({ n: 7, kind: 'read', label: 'Read Prompts', status: 'error', detail: 'Timed out' }),
    step({ n: 8, kind: 'read', label: 'Read Action Center', status: 'running' }),
  ];

  it('takes every step done but thinking, in order', () => {
    expect(doneSteps(steps).map((s) => s.n)).toEqual([2, 3, 4, 5, 6]);
  });

  it('lists every step but thinking and questions, whatever its status', () => {
    const ask = step({ n: 9, kind: 'ask', label: 'Asked which page', status: 'done' });
    expect(listedSteps([ask, ...steps]).map((s) => s.n)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('takes a read without "Read …" words (going to a page of the app) as no source', () => {
    const goTo = step({ n: 1, kind: 'read', label: 'Opened a page' });
    expect(statusLine([{ ...goTo, status: 'running' }], false)).toEqual({
      key: 'other',
      values: { label: 'Opened a page' },
    });
    expect(dataUsed([goTo, step({ n: 2, kind: 'read', label: 'Worked on a step' })])).toEqual([]);
  });

  it('names memory by its subject, counted in items (CHAT-14 item 17)', () => {
    const memory = step({
      n: 1,
      kind: 'read',
      label: 'Used memory',
      rowCount: 3,
      scope: { subject: 'Memory', unit: 'items' },
    });
    expect(dataUsed([memory, ...steps])).toEqual([
      { label: 'Memory', items: 3 },
      { label: 'Citations' },
      { label: 'ansvisor.com/pricing' },
    ]);
  });

  it('names a read of one record by the record, not its source (UX audit CH-10)', () => {
    const read = (n: number, record?: string) =>
      step({ n, kind: 'read', label: 'Read action', ...(record ? { scope: { record } } : {}) });
    expect(
      dataUsed([
        step({ n: 1, kind: 'read', label: 'Read Action Center' }),
        read(2, 'AC-12'),
        read(3, 'AC-07'),
        read(4, 'AC-12'),
        // A step from before records were kept: its source, as before.
        read(5),
      ]),
    ).toEqual([
      { label: 'Action Center' },
      { label: 'AC-12' },
      { label: 'AC-07' },
      { label: 'action' },
    ]);
  });

  it('names each source once, never with its rows, and each page opened; skills, checks and failed reads aren’t sources', () => {
    expect(dataUsed(steps)).toEqual([{ label: 'Citations' }, { label: 'ansvisor.com/pricing' }]);
  });

  it('names a read of 0 rows as any other source, with no count', () => {
    expect(
      dataUsed([
        step({ n: 1, kind: 'read', label: 'Read Action Center', rowCount: 50 }),
        step({ n: 2, kind: 'read', label: 'Read Action History', rowCount: 0 }),
      ]),
    ).toEqual([{ label: 'Action Center' }, { label: 'Action History' }]);
  });
});

describe('stepsSummary', () => {
  const read = (n: number, label: string, over: Partial<ChatStep> = {}) =>
    step({ n, kind: 'read', label, rowCount: 50, ...over });
  const check = step({ n: 9, kind: 'check', label: 'Checked facts' });

  it('has nothing to say before a step is done', () => {
    expect(stepsSummary([])).toBeNull();
    expect(stepsSummary([step({ n: 1, kind: 'thinking', label: 'Thinking' })])).toBeNull();
    expect(stepsSummary([read(1, 'Read Citations', { status: 'running' })])).toBeNull();
  });

  it('counts the sources and pages read, each once, and names a fact check after them', () => {
    expect(
      stepsSummary([
        read(1, 'Read Citations'),
        read(2, 'Read Mentions'),
        read(3, 'Read Citations'),
      ]),
    ).toEqual({ kind: 'reads', sources: 2, pages: 0, checked: false });
    expect(
      stepsSummary([
        read(1, 'Read Citations'),
        step({ n: 2, kind: 'open_page', label: 'Opened ansvisor.com/pricing' }),
        check,
      ]),
    ).toEqual({ kind: 'reads', sources: 1, pages: 1, checked: true });
    // Memory is a source, by its subject.
    expect(
      stepsSummary([
        read(1, 'Used memory', { rowCount: 3, scope: { subject: 'Memory', unit: 'items' } }),
        read(2, 'Read Citations'),
      ]),
    ).toEqual({ kind: 'reads', sources: 2, pages: 0, checked: false });
  });

  it('counts no source and no page when every step done is a check, and names the check', () => {
    expect(
      stepsSummary([
        step({ n: 1, kind: 'check', label: 'Read your choices in the editor' }),
        check,
      ]),
    ).toEqual({ kind: 'reads', sources: 0, pages: 0, checked: true });
  });

  it('says one step, or one source read twice, in its own words', () => {
    const one = read(1, 'Read Citations');
    expect(stepsSummary([one])).toEqual({ kind: 'one', step: one, checked: false });
    expect(stepsSummary([one, check])).toEqual({ kind: 'one', step: one, checked: true });
    expect(stepsSummary([one, read(2, 'Read Citations')])).toEqual({
      kind: 'one',
      step: one,
      checked: false,
    });
  });

  it('counts the steps when they are not all reads, or a read named no source', () => {
    expect(
      stepsSummary([
        read(1, 'Read Citations'),
        read(2, 'Read Mentions'),
        step({ n: 3, kind: 'skill', label: 'Used skill: FAQ + schema writer' }),
        check,
      ]),
    ).toEqual({ kind: 'steps', count: 4 });
    expect(stepsSummary([read(1, 'Read Citations'), read(2, 'Opened a page')])).toEqual({
      kind: 'steps',
      count: 2,
    });
  });
});
