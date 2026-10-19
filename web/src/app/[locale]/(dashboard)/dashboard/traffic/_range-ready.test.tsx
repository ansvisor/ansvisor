import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RangeReadyProvider, rangeKeyOf, useRangeGate, useRangeReady } from './_range-ready';

/**
 * A new range on the AI Traffic page shows only a spinner until the page and
 * every section have its data; a settled range stays shown.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Section({ id, ready }: { id: string; ready: boolean }) {
  useRangeReady(id, ready);
  return null;
}

function Page({
  range,
  own,
  sections,
}: {
  range: string;
  own: boolean;
  sections: Record<string, boolean>;
}) {
  const gate = useRangeGate(range, own);
  return (
    <RangeReadyProvider value={gate.value}>
      <p>{gate.settled ? 'shown' : 'spinner'}</p>
      {Object.entries(sections).map(([id, ready]) => (
        <Section key={id} id={id} ready={ready} />
      ))}
    </RangeReadyProvider>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const render = async (props: Parameters<typeof Page>[0]) => {
  await act(async () => root.render(<Page {...props} />));
  await act(async () => vi.advanceTimersByTime(1));
  return container.textContent;
};

describe('the range gate', () => {
  it('waits for the page and every section, then shows the range', async () => {
    expect(await render({ range: 'a', own: false, sections: { pages: true } })).toBe('spinner');
    expect(await render({ range: 'a', own: true, sections: { pages: false, bots: true } })).toBe(
      'spinner',
    );
    expect(await render({ range: 'a', own: true, sections: { pages: true, bots: true } })).toBe(
      'shown',
    );
  });

  it("doesn't hide a settled range when a section reads again for a tab", async () => {
    await render({ range: 'a', own: true, sections: { pages: true } });
    expect(await render({ range: 'a', own: true, sections: { pages: false } })).toBe('shown');
  });

  it('hides the page again for a new range, until its sections have it', async () => {
    await render({ range: 'a', own: true, sections: { pages: true } });
    // The same render the range changes in: the section still holds range a.
    expect(await render({ range: 'b', own: true, sections: { pages: true } })).toBe('shown');
    // ...because it hadn't said otherwise: a section that has nothing to read
    // for b is ready for b straight away. One still reading keeps it hidden.
    expect(await render({ range: 'c', own: true, sections: { pages: false } })).toBe('spinner');
    expect(await render({ range: 'c', own: true, sections: { pages: true } })).toBe('shown');
  });

  it('shows the page after 20 s even if a read hangs', async () => {
    expect(await render({ range: 'a', own: true, sections: { pages: false } })).toBe('spinner');
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(container.textContent).toBe('shown');
  });
});

describe('rangeKeyOf', () => {
  it('names a window by its two ends; all time has none', () => {
    expect(rangeKeyOf({ dateFrom: '2026-10-12T00:00:00Z', dateTo: '2026-10-19T00:00:00Z' })).toBe(
      '2026-10-12T00:00:00Z|2026-10-19T00:00:00Z',
    );
    expect(rangeKeyOf({})).toBe('|');
  });
});
