import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useStartBrief } = await import('./_use-start-brief');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * A draft the Action Center's Start now just wrote (AC-ACTION-PLAN spec §10
 * item 5): its brief built once as it opens, only when it has none, and the
 * address cleared so a reload builds nothing.
 */

let container: HTMLDivElement;
let root: Root;
const build = vi.fn();

function Probe({ hasBrief }: { hasBrief: boolean | null }) {
  useStartBrief({ hasBrief, build });
  return null;
}
const render = (hasBrief: boolean | null) =>
  act(async () => root.render(<Probe hasBrief={hasBrief} />));

beforeEach(() => {
  build.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  window.history.replaceState(null, '', '/');
});

describe('useStartBrief', () => {
  it('builds the brief once it reads that there is none, and clears the address', async () => {
    window.history.replaceState(null, '', '/dashboard/content/editor/d1?brief=build&tab=x');
    await render(null);
    expect(window.location.search).toBe('?tab=x');
    expect(build).not.toHaveBeenCalled();
    await render(false);
    expect(build).toHaveBeenCalledTimes(1);
    await render(null);
    await render(false);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds nothing for a draft that has a brief, or one opened without the ask', async () => {
    window.history.replaceState(null, '', '/dashboard/content/editor/d1?brief=build');
    await render(true);
    expect(build).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/dashboard/content/editor/d1');
    await render(false);
    expect(build).not.toHaveBeenCalled();
  });
});
