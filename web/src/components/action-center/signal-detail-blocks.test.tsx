import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from '@/lib/signals/map';
import { NO_WHERE } from '@/lib/signals/where';

const getSignalActions = vi.fn();
vi.mock('@/lib/actions/signals', () => ({
  getSignalActions: (...args: unknown[]) => getSignalActions(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SignalChangeBlock, SignalEvidenceBlock, SignalWhereBlock } =
  await import('./signal-detail-blocks');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  getSignalActions.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const signal = (over: Partial<Signal>): Signal => ({
  id: 's1',
  category: 'visibility',
  kind: 'platform_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-08T10:53:00+00:00',
  lastDetectedAt: '2026-10-09T10:53:00+00:00',
  resolvedAt: null,
  previousValue: 34,
  currentValue: 18,
  changeValue: -16,
  payload: {
    entity: 'platforms',
    platform: 'gemini-web',
    targets: [{ id: 'gemini-web', label: 'gemini-web' }],
  },
  kpiKeys: [],
  actionId: null,
  where: { platforms: ['gemini-web'], regions: [], topics: [] },
  ...over,
});

describe('SignalChangeBlock', () => {
  it('labels every figure with its metric, window and unit', () => {
    render(<SignalChangeBlock signal={signal({})} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Last 7 days against the 7 days before');
    expect(text).toContain('Mention rate · previous 7 days34%');
    expect(text).toContain('Mention rate · last 7 days18%');
    expect(text).toContain('−16 pts');
    // A fall in the brand's own rate is bad news.
    const delta = [...container.querySelectorAll('span')].find((s) => s.textContent === '−16 pts');
    expect(delta?.className).toContain('text-red-600');
  });

  it("colours a competitor's rise as bad news", () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'competitor',
          kind: 'competitor_momentum',
          payload: { entity: 'competitors', competitorName: 'Profound' },
          previousValue: 12,
          currentValue: 31,
          changeValue: 19,
        })}
      />,
    );
    const delta = [...container.querySelectorAll('span')].find((s) => s.textContent === '+19');
    expect(delta?.className).toContain('text-red-600');
    expect(container.textContent).toContain('Mentions · Profound · last 7 days31');
  });

  it("names a source's counts rather than showing 0 → 251 +167", () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'competitor',
          kind: 'competitor_winning_source',
          payload: { entity: 'sources', domain: 'yotpo.com', prompts: 6 },
          previousValue: 0,
          currentValue: 251,
          changeValue: 167,
        })}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Answers citing it · all251');
    expect(text).toContain('Answers citing it · naming you0');
    expect(text).toContain('Answers citing it · naming only competitors167');
  });

  it('says so when a signal records no figures', () => {
    render(
      <SignalChangeBlock
        signal={signal({
          category: 'citation',
          kind: 'lost_citations',
          payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
          previousValue: null,
          currentValue: null,
          changeValue: null,
        })}
      />,
    );
    expect(container.textContent).toBe('What changedNot available');
  });
});

describe('SignalWhereBlock', () => {
  it('shows each field, with "Not available" where no detector records it', () => {
    render(
      <SignalWhereBlock
        signal={signal({
          category: 'citation',
          kind: 'lost_citations',
          payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
          where: { platforms: ['chatgpt-web'], regions: ['US'], topics: ['Coffee'] },
        })}
      />,
    );
    const rows = [...container.querySelectorAll('dt')].map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toEqual([
      'Prompt: Best coffee subscription?View prompt',
      'Topic: Coffee',
      'Tracked on: ChatGPT',
      'Tracked in: United States',
      'Your page cited before: Not available',
      'Cited now: Not available',
    ]);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/prompts/p1');
  });
});

describe('SignalEvidenceBlock', () => {
  it('links the answers and the action the signal is used by', async () => {
    getSignalActions.mockResolvedValue([
      { id: 'a1', actionNo: 52, kind: 'unknown_kind_for_test', status: 'new', payload: {} },
    ]);
    await act(async () => {
      render(
        <SignalEvidenceBlock
          brandId="b1"
          signal={signal({ payload: { promptId: 'p1', promptText: 'x' }, actionId: 'a1' })}
        />,
      );
    });
    expect(getSignalActions).toHaveBeenCalledWith('b1', ['a1']);
    const links = [...container.querySelectorAll('a')].map(
      (a) => `${a.textContent} → ${a.getAttribute('href')}`,
    );
    expect(links).toEqual([
      'View AI answers → /dashboard/prompts/p1',
      'AC-52 · Unknown kind for test → /dashboard/action-center/actions?action=a1',
    ]);
  });

  it('says when no action uses the signal, without asking', () => {
    render(<SignalEvidenceBlock brandId="b1" signal={signal({ where: NO_WHERE })} />);
    expect(getSignalActions).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No action uses this signal yet.');
  });
});
