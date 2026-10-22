import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { Opportunities } from './_opportunities';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ trackSuggestions: vi.fn() }));
vi.mock('@/lib/actions/topic', () => ({ sendTopicOpportunityToActionCenter: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({
  generateOpportunitiesOnDemand: vi.fn(),
  getGenerationJobStatus: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const suggestion = (id: string, topic: string | null, estVolume: number) => ({
  id,
  text: `Prompt ${id}`,
  topicId: topic ? `t-${topic}` : null,
  topicName: topic,
  estVolume,
  relevance: 0.9,
});

describe('Opportunities — estimated volume (PROMPT-013)', () => {
  it("shows the suggestions' AI-guessed volume as a grey range, never a bare number", () => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Opportunities
            brandId="b1"
            suggestions={[
              suggestion('s1', 'Espresso', 800),
              suggestion('s2', 'Espresso', 400),
              suggestion('s3', null, 350),
            ]}
            trackedTopicIds={[]}
            topics={null}
            entities={null}
            slotsLeft={null}
            contentUsage={null}
            onTracked={() => {}}
          />
        </NextIntlClientProvider>,
      ),
    );
    const ranges = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-label*="a month, estimated"]'),
    ];
    // The topic's 1,200 and the lone prompt's 350, each half to twice, low.
    expect(ranges.map((r) => r.textContent)).toEqual(['600–2.4k/mo', '170–700/mo']);
    expect(ranges.every((r) => r.className.includes('text-muted-foreground'))).toBe(true);
    expect(container.textContent).toContain('2 prompts\u00a0·\u00a0600–2.4k/mo');
    expect(container.textContent).not.toContain('~');
  });
});
