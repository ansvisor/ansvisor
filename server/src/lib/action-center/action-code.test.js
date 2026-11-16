import { describe, expect, it } from 'vitest';
import { actionCode } from './action-code.js';

// The owner's ask (14 Nov): each brand numbers its actions from AC-01 (00534).
describe('actionCode', () => {
  it("is the brand's number, two digits at least, from a row or a mapped action", () => {
    expect(actionCode({ action_no: 648, brand_no: 3 })).toBe('AC-03');
    expect(actionCode({ actionNo: 648, brandNo: 53 })).toBe('AC-53');
    expect(actionCode({ action_no: 648, brand_no: 120 })).toBe('AC-120');
  });

  it('is the old global number until the brand is numbered', () => {
    expect(actionCode({ action_no: 648, brand_no: null })).toBe('AC-648');
    expect(actionCode({ actionNo: 251 })).toBe('AC-251');
  });
});
