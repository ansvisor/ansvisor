import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { ImprovingAction } from '@/lib/improve-outcome';

/**
 * The Work cell's Improve link (PROMPT-008): the table's own read brings the
 * brand's (no read of its own when the rows show), the rows on screen are
 * read again when the panel closes; "AC-12 · Improving" opens the Improve tab.
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

type ProbeProps = {
  brandId: string;
  ids: string[];
  panelOpen: boolean;
  seed?: Record<string, ImprovingAction>;
};
const NO_SEED: Record<string, ImprovingAction> = {};

/** Shows what the hook gives, for `seen()` to read. */
function Probe(props: ProbeProps) {
  const byPrompt = useImprovingPrompts(
    props.brandId,
    props.ids,
    props.panelOpen,
    props.seed ?? NO_SEED,
  );
  return <output>{JSON.stringify(byPrompt)}</output>;
}
const seen = () => JSON.parse(container.querySelector('output')!.textContent!);

async function renderProbe(props: ProbeProps) {
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
  const AC9: ImprovingAction = { ...AC12, actionId: 'a9', brandNo: 9 };

  it("shows the table read's actions, with no read of its own, whatever the rows", async () => {
    const seed = { p2: AC12 };
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2', 'p3'], panelOpen: false, seed });
    expect(seen()).toEqual({ p2: AC12 });
    // Another page of rows: still none.
    await renderProbe({ brandId: 'b1', ids: ['p4', 'p5'], panelOpen: false, seed });
    expect(getImprovingPrompts).not.toHaveBeenCalled();
  });

  it('reads the rows on screen once the panel closes, and shows what it says for them', async () => {
    const seed = { p2: AC12, p9: AC9 };
    getImprovingPrompts.mockResolvedValue({ p1: AC9 });
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2'], panelOpen: false, seed });
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2'], panelOpen: true, seed });
    expect(getImprovingPrompts).not.toHaveBeenCalled();
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2'], panelOpen: false, seed });
    expect(getImprovingPrompts).toHaveBeenCalledExactlyOnceWith('b1', ['p1', 'p2']);
    // p2's action is no longer tracked, p1 has one now; p9, off screen, keeps the seed's.
    expect(seen()).toEqual({ p1: AC9, p9: AC9 });

    // A newer table read wins over the re-read.
    const newer = { p2: AC12 };
    await renderProbe({ brandId: 'b1', ids: ['p1', 'p2'], panelOpen: false, seed: newer });
    expect(seen()).toEqual({ p2: AC12 });
  });

  it('keeps the seed when the re-read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getImprovingPrompts.mockRejectedValue(new Error('timeout'));
    const seed = { p1: AC12 };
    await renderProbe({ brandId: 'b1', ids: ['p1'], panelOpen: true, seed });
    await renderProbe({ brandId: 'b1', ids: ['p1'], panelOpen: false, seed });
    expect(getImprovingPrompts).toHaveBeenCalledOnce();
    expect(seen()).toEqual({ p1: AC12 });
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
