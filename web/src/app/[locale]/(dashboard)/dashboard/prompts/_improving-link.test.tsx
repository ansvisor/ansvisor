import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { ImprovingAction } from '@/lib/improve-outcome';

/**
 * The Work cell's Improve link (PROMPT-008): one read for the rows on
 * screen, read again when the panel closes; "AC-12 · Improving" opens the
 * Improve tab.
 */

const getImprovingPrompts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/prompt-positions', () => ({ getImprovingPrompts }));

const { ImprovingLink, useImprovingPrompts } = await import('./_improving-link');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const AC12: ImprovingAction = {
  actionId: 'a12',
  actionNo: 1497,
  brandNo: 12,
  avgBefore: null,
  avgAfter: null,
};

let container: HTMLDivElement;
let root: Root;

/** Shows what the hook gives, for `seen()` to read. */
function Probe(props: { brandId: string; ids: string[]; panelOpen: boolean }) {
  const byPrompt = useImprovingPrompts(props.brandId, props.ids, props.panelOpen);
  return <output>{JSON.stringify(byPrompt)}</output>;
}
const seen = () => JSON.parse(container.querySelector('output')!.textContent!);

async function renderProbe(props: { brandId: string; ids: string[]; panelOpen: boolean }) {
  await act(async () => root.render(<Probe {...props} />));
  await act(async () => {});
}

beforeEach(() => {
  getImprovingPrompts.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useImprovingPrompts', () => {
  it('reads the rows on screen in one call, and again when the panel closes', async () => {
    getImprovingPrompts.mockResolvedValue({ p2: AC12 });
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2', 'p3'], panelOpen: false });
    expect(getImprovingPrompts).toHaveBeenCalledTimes(1);
    expect(getImprovingPrompts).toHaveBeenCalledWith('b1', ['p1', 'p2', 'p3']);
    expect(seen()).toEqual({ p2: AC12 });

    // The same rows in another order: no new read.
    await renderProbe({ brandId: 'b1', ids: ['p3', 'p2', 'p1'], panelOpen: false });
    expect(getImprovingPrompts).toHaveBeenCalledTimes(1);

    await renderProbe({ brandId: 'b1', ids: ['p3', 'p2', 'p1'], panelOpen: true });
    expect(getImprovingPrompts).toHaveBeenCalledTimes(1);
    await renderProbe({ brandId: 'b1', ids: ['p3', 'p2', 'p1'], panelOpen: false });
    expect(getImprovingPrompts).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for no rows, and never shows another brand's answer", async () => {
    await renderProbe({ brandId: 'b1', ids: [], panelOpen: false });
    expect(getImprovingPrompts).not.toHaveBeenCalled();
    expect(seen()).toEqual({});

    getImprovingPrompts.mockResolvedValueOnce({ p1: AC12 });
    await renderProbe({ brandId: 'b1', ids: ['p1'], panelOpen: false });
    expect(seen()).toEqual({ p1: AC12 });
    getImprovingPrompts.mockReturnValueOnce(new Promise(() => {}));
    await renderProbe({ brandId: 'b2', ids: ['p1'], panelOpen: false });
    expect(seen()).toEqual({});
  });

  it('shows nothing when the read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getImprovingPrompts.mockRejectedValue(new Error('timeout'));
    await renderProbe({ brandId: 'b1', ids: ['p1'], panelOpen: false });
    expect(seen()).toEqual({});
    error.mockRestore();
  });
});

describe('ImprovingLink', () => {
  it("names the action's code, says what it opens, and opens it", async () => {
    const onOpen = vi.fn();
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ImprovingLink action={AC12} onOpen={onOpen} />
        </NextIntlClientProvider>,
      ),
    );
    const link = container.querySelector('button')!;
    expect(link.type).toBe('button');
    expect(link.textContent).toBe('AC-12 · Improving');
    expect(link.getAttribute('aria-label')).toBe('AC-12 · Improving: open the Improve tab');
    expect(link.title).toBe('Open the Improve tab · AC-12 is still being tracked');
    act(() => link.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
