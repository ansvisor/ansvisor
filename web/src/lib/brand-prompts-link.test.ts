import { describe, expect, it, vi } from 'vitest';
import { brandPromptsLink, pickOnOpen, TRACKED_PROMPTS_HREF } from './brand-prompts-link';

describe('brandPromptsLink', () => {
  it('opens Tracked Prompts, never the brand’s own prompts page', () => {
    expect(TRACKED_PROMPTS_HREF).toBe('/dashboard/prompts/tracked');
    expect(brandPromptsLink('b1', vi.fn()).href).toBe('/dashboard/prompts/tracked');
  });

  it('picks the brand on a click', () => {
    const setActiveBrand = vi.fn();
    brandPromptsLink('b1', setActiveBrand).onClick();
    expect(setActiveBrand).toHaveBeenCalledWith('b1');
  });

  it('picks the brand on a middle click, which opens a new tab, and not on a right click', () => {
    const setActiveBrand = vi.fn();
    const link = brandPromptsLink('b1', setActiveBrand);
    link.onAuxClick({ button: 2 });
    expect(setActiveBrand).not.toHaveBeenCalled();
    link.onAuxClick({ button: 1 });
    expect(setActiveBrand).toHaveBeenCalledWith('b1');
  });
});

describe('pickOnOpen', () => {
  it('runs the pick on a click and a middle click only', () => {
    const pick = vi.fn();
    const handlers = pickOnOpen(pick);
    handlers.onAuxClick({ button: 0 });
    handlers.onAuxClick({ button: 2 });
    expect(pick).not.toHaveBeenCalled();
    handlers.onClick();
    handlers.onAuxClick({ button: 1 });
    expect(pick).toHaveBeenCalledTimes(2);
  });
});
