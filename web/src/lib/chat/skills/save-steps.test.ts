import { describe, expect, it, vi } from 'vitest';
import type { NextMoveInput } from '../next-moves';
import {
  MAX_STEPS_TO_SAVE,
  offersSaveSteps,
  stepsToSave,
  withSaveStepsMove,
  type RunStepRow,
} from './save-steps';

// The pure parts only: the reads are the engine's tests'.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const step = (over: Partial<RunStepRow> = {}): RunStepRow => ({
  kind: 'read',
  status: 'done',
  label: 'Read Citations',
  tool: 'list_citations',
  scope_json: null,
  ...over,
});

const move = (kind: NextMoveInput['kind'], prompt = `Do the ${kind} move`): NextMoveInput => ({
  label: prompt,
  prompt,
  kind,
  class: 'read',
});

const WORDS = { label: 'Save these steps as a skill', prompt: 'Save these steps as a skill' };

describe('when a run offers to save its steps (W4-32)', () => {
  it('offers it after two done work steps or more', () => {
    expect(offersSaveSteps([step(), step({ kind: 'check', label: 'Checked the facts' })])).toBe(
      true,
    );
    expect(offersSaveSteps([step(), step({ kind: 'write', tool: 'create_draft' })])).toBe(true);
  });

  it('not after one, nor for thinking, questions, skills or steps that didn’t finish', () => {
    expect(offersSaveSteps([step()])).toBe(false);
    expect(
      offersSaveSteps([
        step(),
        step({ kind: 'thinking', tool: null }),
        step({ kind: 'ask', tool: null }),
        step({ kind: 'skill', tool: null }),
        step({ status: 'error' }),
        step({ status: 'skipped' }),
      ]),
    ).toBe(false);
  });

  it('not after a run that saved a skill itself', () => {
    expect(offersSaveSteps([step(), step(), step({ kind: 'write', tool: 'save_skill' })])).toBe(
      false,
    );
  });
});

describe('the move among the model’s', () => {
  it('goes third, after the model’s first two', () => {
    const out = withSaveStepsMove([move('continue'), move('deepen'), move('act')], WORDS);
    expect(out.map((m) => m.kind)).toEqual(['continue', 'deepen', 'reuse', 'act']);
    expect(out[2]).toEqual({ ...WORDS, kind: 'reuse', class: 'write' });
  });

  it('goes last with fewer, and alone with none', () => {
    expect(withSaveStepsMove([move('continue')], WORDS).map((m) => m.kind)).toEqual([
      'continue',
      'reuse',
    ]);
    expect(withSaveStepsMove([], WORDS)).toEqual([{ ...WORDS, kind: 'reuse', class: 'write' }]);
  });

  it('takes the place of the model’s own reuse move, and of one with its prompt', () => {
    const out = withSaveStepsMove(
      [
        move('reuse', 'Make this a template'),
        move('continue'),
        move('act', 'save these steps as a skill'),
      ],
      WORDS,
    );
    expect(out.map((m) => m.prompt)).toEqual(['Do the continue move', WORDS.prompt]);
  });
});

describe('the steps a draft is built from', () => {
  it('keeps the done work steps in order, with the scope that holds for any run', () => {
    expect(
      stepsToSave([
        step({ kind: 'thinking', tool: null, label: 'Thought' }),
        step({
          scope_json: {
            subject: 'Pricing prompts',
            dateRange: 'Last 30 days',
            platforms: ['ChatGPT', 'Perplexity'],
            brand: 'Acme',
          },
        }),
        step({ kind: 'open_page', label: 'Opened /pricing', tool: 'fetch_page' }),
      ]),
    ).toEqual([
      {
        label: 'Read Citations',
        tool: 'list_citations',
        subject: 'Pricing prompts',
        dateRange: 'Last 30 days',
        platforms: ['ChatGPT', 'Perplexity'],
      },
      { label: 'Opened /pricing', tool: 'fetch_page' },
    ]);
  });

  it('leaves out one run’s dates, the brand and figures', () => {
    expect(
      stepsToSave([
        step({
          label: 'Read the top 10 prompts',
          scope_json: { subject: 'Prompts above 25%', dateRange: '1–15 Oct', brand: 'Acme' },
        }),
      ]),
    ).toEqual([
      { label: 'Read the top # prompts', tool: 'list_citations', subject: 'Prompts above #' },
    ]);
  });

  it(`keeps at most ${MAX_STEPS_TO_SAVE}`, () => {
    expect(stepsToSave(Array.from({ length: 20 }, () => step()))).toHaveLength(MAX_STEPS_TO_SAVE);
  });
});
