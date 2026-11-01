import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { AiUsage } from '@/lib/billing/ai-usage';
import {
  AuditEstimateCard,
  AuditEstimateChip,
  ESTIMATE_DELAY_MS,
  useAuditEstimate,
  type AuditEstimateState,
} from './_audit-estimate';

/**
 * The draft's Site Audit estimate (customer priorities item 9): read again
 * once the page settles, for free; its AI checks on request.
 */

const readAuditEstimate = vi.fn();
vi.mock('@/lib/content/audit-estimate', async (importOriginal) => ({
  ...(await importOriginal()),
  readAuditEstimate: (...args: unknown[]) => readAuditEstimate(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
let usage: AiUsage | null;
const refresh = vi.fn();
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage, refresh }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ESTIMATE = {
  score: 62,
  categories: { structure: 78, content: 55, authority: 40, trust: 72, eeat: 48 },
  checks: { page: 18, site: 13, ai: 0 },
};
const VERDICTS = [{ key: 'direct-answer', status: 'pass', score: 1 }];

let container: HTMLDivElement;
let root: Root;
let state: AuditEstimateState;

function Harness({ doc }: { doc: string }) {
  state = useAuditEstimate('d1', 'b1', doc);
  return (
    <>
      <AuditEstimateChip state={state} />
      <AuditEstimateCard state={state} />
    </>
  );
}
async function render(doc: string) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Harness doc={doc} />
      </NextIntlClientProvider>,
    ),
  );
}
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(ESTIMATE_DELAY_MS);
  });
  await act(async () => {});
};
const card = () => container.querySelector<HTMLElement>('[data-slot="audit-estimate"]')!;
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-01T14:02:00Z'));
  usage = {
    plan: 'starter',
    planName: 'Starter',
    periodStart: null,
    periodEnd: null,
    unlimited: false,
    percentUsed: 41.2,
    features: [],
    estimates: { writeThis: 3.4, auditAiChecks: 0.1 },
  };
  readAuditEstimate.mockReset().mockResolvedValue({ estimate: ESTIMATE });
  refresh.mockReset();
  toast.error.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the Site Audit estimate', () => {
  it('is read once the page settles, for free, and shows the score, its categories and what it rests on', async () => {
    await render('<p>one</p>');
    expect(readAuditEstimate).not.toHaveBeenCalled();
    expect(button('Audit ≈…')).toBeDefined();
    await settle();
    expect(readAuditEstimate).toHaveBeenCalledWith('d1', 'b1', '<p>one</p>', {
      verdicts: undefined,
    });
    expect(button('Audit ≈62')).toBeDefined();
    const text = card().textContent!;
    expect(text).toContain('Site Audit estimate');
    expect(text).toContain('≈62');
    expect(text).toContain(
      'From the 31 checks Site Audit runs on the page and your site, read again as you write.',
    );
    expect(text).toContain(
      "The 13 checks AI reads aren't in it yet: estimates like this run about 6 points under the full audit.",
    );
    expect([...card().querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Structure78/100',
      'Content55/100',
      'Authority40/100',
      'E-E-A-T48/100',
      'Trust72/100',
    ]);
    expect(text).toContain('Uses under 1% of your monthly AI usage');
  });

  it('reads again only once typing pauses, and says when the site has no audit yet', async () => {
    await render('<p>one</p>');
    await settle();
    readAuditEstimate.mockResolvedValue({
      estimate: { ...ESTIMATE, checks: { page: 18, site: 0, ai: 0 } },
    });
    await render('<p>one two</p>');
    await act(async () => vi.advanceTimersByTime(ESTIMATE_DELAY_MS / 2));
    await render('<p>one two three</p>');
    await settle();
    expect(readAuditEstimate).toHaveBeenCalledTimes(2);
    expect(readAuditEstimate.mock.calls[1][2]).toBe('<p>one two three</p>');
    expect(card().textContent).toContain('Site-wide checks join once your site has a Site Audit.');
  });

  it('reads the AI checks on request, keeps their verdicts as the page changes, and reads the meter again', async () => {
    await render('<p>one</p>');
    await settle();
    readAuditEstimate.mockResolvedValueOnce({
      estimate: { ...ESTIMATE, score: 68, checks: { page: 18, site: 13, ai: 13 } },
      verdicts: VERDICTS,
    });
    await act(async () => button('Estimate AI checks')!.click());
    expect(readAuditEstimate).toHaveBeenLastCalledWith('d1', 'b1', '<p>one</p>', { ai: true });
    expect(refresh).toHaveBeenCalled();
    expect(card().textContent).toContain('≈68');
    expect(card().textContent).toContain('With the checks AI read at 2:02 PM.');
    expect(button('Read AI checks again')).toBeDefined();

    readAuditEstimate.mockResolvedValue({
      estimate: { ...ESTIMATE, score: 70, checks: { page: 18, site: 13, ai: 13 } },
    });
    await render('<p>one more</p>');
    await settle();
    expect(readAuditEstimate).toHaveBeenLastCalledWith('d1', 'b1', '<p>one more</p>', {
      verdicts: VERDICTS,
    });
    expect(card().textContent).toContain('≈70');
  });

  it('says why the AI checks didn’t run, and keeps the free estimate', async () => {
    await render('<p>one</p>');
    await settle();
    readAuditEstimate.mockResolvedValueOnce({ error: 'ai_budget' });
    await act(async () => button('Estimate AI checks')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "This month's AI usage is spent, so the AI checks didn't run.",
    );
    expect(card().textContent).toContain('≈62');
    expect(button('Estimate AI checks')!.disabled).toBe(false);
  });

  it('says nothing of AI usage where it isn’t metered, and hides the chip when it can’t read', async () => {
    usage = null;
    readAuditEstimate.mockResolvedValue({ error: 'failed' });
    await render('<p>one</p>');
    await settle();
    expect(card().textContent).toContain("Couldn't read the estimate.");
    expect(card().textContent).not.toContain('AI usage');
    expect(container.textContent).not.toContain('Audit ≈');
  });
});
