import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { PAST_DEADLINE, REPORT_CARD_ENGINES, askEngines } = await import('./engines.js');

const questions = [{ text: 'q one' }, { text: 'q two' }];

describe('askEngines', () => {
  it('asks every question in the four engines from the country', async () => {
    const submit = vi.fn(async (text, engine) => ({ taskId: `${engine}|${text}` }));
    const poll = vi.fn(async (taskId) => ({
      text: `answer to ${taskId}`,
      citations: [{ url: 'https://example.org/a' }],
    }));
    const { engines, tasks, answers } = await askEngines(questions, 'TR', {
      submit,
      poll,
      supported: new Map(),
    });
    expect(engines).toEqual(REPORT_CARD_ENGINES);
    expect(tasks).toBe(8);
    expect(submit).toHaveBeenCalledWith('q one', 'chatgpt-web', 'TR');
    expect(answers).toHaveLength(8);
    expect(answers[0]).toEqual({
      question: 0,
      engine: 'chatgpt-web',
      text: 'answer to chatgpt-web|q one',
      citations: [{ url: 'https://example.org/a' }],
      missing: null,
    });
  });

  it('leaves out an engine that doesn’t answer from the country', async () => {
    const supported = new Map([
      ['gemini', new Set(['US'])],
      ['chatgpt', new Set(['US', 'TR'])],
    ]);
    const { engines } = await askEngines(questions, 'TR', {
      submit: async () => ({ taskId: 't' }),
      poll: async () => ({ text: 'a', citations: [] }),
      supported,
    });
    expect(engines).not.toContain('gemini-web');
    expect(engines).toContain('chatgpt-web');
  });

  it('counts no AI Overview as no answer, and a failure as failed, each paid once submitted', async () => {
    const poll = vi.fn(async (taskId, engine) => {
      if (engine === 'google-aio')
        throw new Error('Google did not return an AI Overview for this query');
      if (engine === 'gemini-web') throw new Error('Cloro task t failed: blocked');
      return { text: 'fine', citations: [] };
    });
    const submit = vi.fn(async (text, engine) => {
      if (engine === 'google-aimode' && text === 'q two')
        throw new Error('Cloro async submit error 500');
      return { taskId: 't' };
    });
    const { tasks, answers } = await askEngines(questions, 'US', {
      submit,
      poll,
      supported: new Map(),
    });
    const of = (engine) => answers.filter((a) => a.engine === engine).map((a) => a.missing);
    expect(of('chatgpt-web')).toEqual([null, null]);
    expect(of('google-aio')).toEqual(['no_answer', 'no_answer']);
    expect(of('gemini-web')).toEqual(['failed', 'failed']);
    expect(of('google-aimode')).toEqual([null, 'failed']);
    // Submitted: all but the refused submission.
    expect(tasks).toBe(7);
  });

  it('submits nothing past the deadline, and waits no longer than it for an answer', async () => {
    let t = 1_000;
    const submit = vi.fn(async () => ({ taskId: 't' }));
    const poll = vi.fn(async () => {
      t += 600; // Each answer moves the clock on.
      return { text: 'a', citations: [] };
    });
    const { tasks, answers } = await askEngines(questions, 'US', {
      submit,
      poll,
      supported: new Map(),
      inFlight: 1,
      maxWaitMs: 5_000,
      deadline: 2_500,
      clock: () => t,
    });
    // Asked at 1000, 1600 and 2200; the rest would start past 2500.
    expect(submit).toHaveBeenCalledTimes(3);
    expect(poll.mock.calls.map((c) => c[2].maxWaitMs)).toEqual([1_500, 900, 300]);
    expect(tasks).toBe(3);
    expect(answers.filter((a) => a.missing === 'failed')).toHaveLength(5);
    expect(PAST_DEADLINE).toMatch(/deadline/);
  });

  it('keeps at most the tasks in flight it is given', async () => {
    let inFlight = 0;
    let most = 0;
    const poll = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { text: 'a', citations: [] };
    };
    await askEngines(questions, 'US', {
      submit: async () => ({ taskId: 't' }),
      poll,
      supported: new Map(),
      inFlight: 3,
    });
    expect(most).toBe(3);
  });
});
