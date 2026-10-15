import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { FanoutEngineCoverage } from '@/lib/actions/fanout';
import { FanoutEngineNotices, FanoutEngineStrip, isSilentEngine } from './_fanout-engines';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const engine = (over: Partial<FanoutEngineCoverage>): FanoutEngineCoverage => ({
  platform: 'copilot-web',
  answers: 100,
  answersWithFanout: 21,
  subQueries: 706,
  lastFanoutAt: null,
  ...over,
});

// What production showed on 2026-10-15: Copilot shares, ChatGPT stopped on
// Sep 30, Google's engines never share.
const engines = [
  engine({}),
  engine({
    platform: 'chatgpt-web',
    answersWithFanout: 0,
    subQueries: 0,
    lastFanoutAt: '2026-09-29T05:12:00Z',
  }),
  engine({ platform: 'google-aio', answersWithFanout: 0, subQueries: 0 }),
  engine({ platform: 'gemini-web', answersWithFanout: 0, subQueries: 0 }),
];

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('FanoutEngineStrip', () => {
  it("shows each engine's share, when a silent one last shared, and the ones that never share", () => {
    const onSelect = vi.fn();
    render(
      <FanoutEngineStrip
        engines={engines}
        totalSubQueries={706}
        selected={null}
        onSelect={onSelect}
      />,
    );

    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual([
      'All engines706',
      'Microsoft Copilot21% of answers · 706',
      'ChatGPTnone since Sep 29',
    ]);
    // Never-sharing engines are labels, not filters.
    expect(container.textContent).toContain('Google AI Overview · not shared');
    expect(container.textContent).toContain('Google Gemini · not shared');

    act(() => container.querySelectorAll('button')[2].click());
    expect(onSelect).toHaveBeenCalledWith('chatgpt-web');
  });

  it('clears the filter when the picked engine is clicked again', () => {
    const onSelect = vi.fn();
    render(
      <FanoutEngineStrip
        engines={engines}
        totalSubQueries={706}
        selected="copilot-web"
        onSelect={onSelect}
      />,
    );
    act(() => container.querySelectorAll('button')[1].click());
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('FanoutEngineNotices', () => {
  it('explains a silent engine and names the engines that never share', () => {
    render(<FanoutEngineNotices engines={engines} />);
    expect(container.textContent).toContain(
      'ChatGPT usually shares the searches behind its answers, but none arrived since Sep 29.',
    );
    expect(container.textContent).toContain(
      "Google AI Overview and Google Gemini don't come with the searches behind their answers",
    );
  });

  it('says nothing once every sharing engine shares again', () => {
    render(<FanoutEngineNotices engines={[engine({})]} />);
    expect(container.textContent).toBe('');
  });
});

describe('isSilentEngine', () => {
  it('is only an engine that shares searches, answered, and shared none', () => {
    expect(isSilentEngine(engines[1])).toBe(true);
    expect(isSilentEngine(engines[0])).toBe(false);
    expect(isSilentEngine(engines[2])).toBe(false);
    // Four answers with none is chance, not an outage.
    expect(
      isSilentEngine(engine({ platform: 'chatgpt-web', answers: 4, answersWithFanout: 0 })),
    ).toBe(false);
  });
});
