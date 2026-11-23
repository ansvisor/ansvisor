import { describe, expect, it } from 'vitest';
import { opportunityFlowState } from './opportunity-flow';

describe('opportunityFlowState', () => {
  it('names the used-up quota first', () => {
    expect(opportunityFlowState({ limitReached: true, needs: { needs: 4, open: 0 } })).toBe(
      'limit',
    );
    expect(opportunityFlowState({ limitReached: true, needs: null })).toBe('limit');
  });

  it('says every need is covered when none is left open', () => {
    expect(opportunityFlowState({ limitReached: false, needs: { needs: 4, open: 0 } })).toBe(
      'allCovered',
    );
  });

  it('says nothing while needs are still open, unread, or there are none', () => {
    expect(opportunityFlowState({ limitReached: false, needs: { needs: 4, open: 1 } })).toBeNull();
    expect(opportunityFlowState({ limitReached: false, needs: null })).toBeNull();
    expect(opportunityFlowState({ limitReached: false, needs: { needs: 0, open: 0 } })).toBeNull();
  });
});
