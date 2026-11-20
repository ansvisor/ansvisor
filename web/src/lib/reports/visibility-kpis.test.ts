import { describe, expect, it } from 'vitest';
import { kpiGridClasses, visibilityKpis } from './visibility-kpis';

const rate = { visiblePrompts: 112, promptCount: 308, ratePct: 36.4 };

describe('visibilityKpis', () => {
  it('leads with the Visibility score, then Prompts with a mention', () => {
    expect(visibilityKpis({ ...rate, score: 15.5 })).toEqual([
      { kind: 'score', score: 15.5 },
      { kind: 'promptsWithMention', ratePct: 36.4, visible: 112, total: 308 },
    ]);
  });

  it('shows only the prompt share on a report saved before the score', () => {
    expect(visibilityKpis(rate)).toEqual([
      { kind: 'promptsWithMention', ratePct: 36.4, visible: 112, total: 308 },
    ]);
  });

  it('has no visibility tile on a report saved before either', () => {
    expect(visibilityKpis(undefined)).toEqual([]);
  });
});

describe('kpiGridClasses', () => {
  it('fits the grid to the tiles, with the note across the whole row', () => {
    expect(kpiGridClasses(5).grid).toContain('xl:grid-cols-5');
    expect(kpiGridClasses(5).note).toContain('xl:col-span-5');
    expect(kpiGridClasses(4).grid).toContain('lg:grid-cols-4');
    expect(kpiGridClasses(3)).toEqual({ grid: 'sm:grid-cols-3', note: 'sm:col-span-3' });
  });
});
