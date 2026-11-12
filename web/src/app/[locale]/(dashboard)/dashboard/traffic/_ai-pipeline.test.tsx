import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TrafficAiPipeline, TrafficDateWindow } from '@/lib/actions/traffic';

/**
 * AI Traffic › AI-sourced pipeline (#2140, 00520): HubSpot's AI-sourced
 * contacts, deals and revenue for the page's range, by engine and page, with
 * HubSpot's own AI Referrals apart; locked below Growth, and saying what's
 * missing until HubSpot is connected, allowed and read.
 */

const getTrafficAiPipeline = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({}));
vi.mock('@/lib/traffic-reads', () => ({
  getTrafficAiPipeline: (...args: unknown[]) => getTrafficAiPipeline(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));
const gate = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => gate.allowed, requiredPlanFor: () => 'Growth' }),
}));
const role = vi.hoisted(() => ({ canManage: true, canAdmin: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));

const { AiPipelineSection, changeOf, money } = await import('./_ai-pipeline');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '33333333-3333-3333-3333-333333333333';
const MONTH: TrafficDateWindow = {
  dateFrom: '2026-10-11T00:00:00.000Z',
  dateTo: '2026-11-09T00:00:00.000Z',
};

const pipeline = (over: Partial<TrafficAiPipeline> = {}): TrafficAiPipeline => ({
  connected: true,
  contactsConsent: true,
  currency: 'USD',
  syncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  syncError: null,
  totals: {
    contacts: 128,
    contactsPrev: 108,
    deals: 23,
    wonDeals: 9,
    wonRevenue: 62300,
    wonRevenuePrev: 57100,
    openDeals: 14,
    openPipeline: 184500,
  },
  byEngine: [
    {
      source: 'chatgpt.com',
      contacts: 71,
      deals: 13,
      wonDeals: 5,
      wonRevenue: 38900,
      openPipeline: 96000,
    },
    {
      source: 'copilot.microsoft.com',
      contacts: 4,
      deals: 0,
      wonDeals: 0,
      wonRevenue: 0,
      openPipeline: 0,
    },
  ],
  byPage: [
    {
      page: 'https://acme.test/pricing',
      contacts: 34,
      deals: 9,
      wonRevenue: 24100,
      topSource: 'chatgpt.com',
    },
  ],
  hubspotNative: { contacts: 0, deals: 0, wonRevenue: 0 },
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AiPipelineSection
          brandId={BRAND}
          brandName="Acme"
          dateWindow={MONTH}
          rangeLabel="last 30 days"
        />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const link = () => container.querySelector('a');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  gate.allowed = true;
  role.canManage = true;
  role.canAdmin = true;
  getTrafficAiPipeline.mockReset().mockResolvedValue(pipeline());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AiPipelineSection', () => {
  it('shows the contacts, deals and revenue for the range, by engine and page', async () => {
    await render();
    expect(getTrafficAiPipeline).toHaveBeenCalledWith(BRAND, MONTH);
    const t = text();
    expect(t).toContain('AI-sourced pipeline');
    expect(t).toContain('Needs HubSpot');
    expect(t).toContain('last 30 days');
    expect(t).toContain('AI-sourced contacts128▲ 19% vs the period before');
    expect(t).toContain('AI-influenced deals239 won · 14 open now');
    expect(t).toContain('Open pipeline$184,50014 open deals');
    expect(t).toContain('Won revenue$62,300▲ 9% vs the period before 9 deals closed won');
    // By engine, by name; an engine with nothing won shows a dash.
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toEqual(['ChatGPT7113$38,900$96,000', 'Copilot40——', '/pricing349$24,100ChatGPT']);
    expect(t).toContain('A deal counts once, in full');
    expect(t).toContain('From HubSpot, synced');
  });

  it('shows HubSpot’s own AI Referrals contacts on a line of their own', async () => {
    getTrafficAiPipeline.mockResolvedValue(
      pipeline({ hubspotNative: { contacts: 12, deals: 2, wonRevenue: 4000 } }),
    );
    await render();
    expect(text()).toContain(
      'HubSpot also counts 12 contacts from its own AI Referrals source on your domains, with 2 deals and $4,000 won.',
    );
  });

  it('says so when the range has nothing yet', async () => {
    getTrafficAiPipeline.mockResolvedValue(
      pipeline({
        totals: {
          contacts: 0,
          contactsPrev: 0,
          deals: 0,
          wonDeals: 0,
          wonRevenue: 0,
          wonRevenuePrev: null,
          openDeals: 0,
          openPipeline: 0,
        },
        byEngine: [],
        byPage: [],
      }),
    );
    await render();
    expect(text()).toContain('No AI-sourced contacts or deals in this range yet.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('is locked below Growth, read from nothing', async () => {
    gate.allowed = false;
    await render();
    expect(getTrafficAiPipeline).not.toHaveBeenCalled();
    expect(text()).toContain('Comes with Growth');
    expect(link()?.getAttribute('href')).toBe('/dashboard/settings/billing');
    role.canAdmin = false;
    await render();
    expect(text()).toContain('Ask an admin to upgrade.');
  });

  it('says what is missing: a connection, consent to mark contacts, or the first read', async () => {
    getTrafficAiPipeline.mockResolvedValue(pipeline({ connected: false }));
    await render();
    expect(text()).toContain("HubSpot isn't connected");
    expect(link()?.getAttribute('href')).toBe('/dashboard/settings/integrations#hubspot');

    await act(async () => root.unmount());
    root = createRoot(container);
    getTrafficAiPipeline.mockResolvedValue(pipeline({ contactsConsent: false }));
    await render();
    expect(text()).toContain('Marking contacts is off');

    await act(async () => root.unmount());
    root = createRoot(container);
    getTrafficAiPipeline.mockResolvedValue(pipeline({ syncedAt: null }));
    await render();
    expect(text()).toContain('Reading HubSpot');

    await act(async () => root.unmount());
    root = createRoot(container);
    getTrafficAiPipeline.mockResolvedValue(pipeline({ syncError: 'auth' }));
    await render();
    expect(text()).toContain('The last read of HubSpot failed.');
  });

  it('says when it couldn’t load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getTrafficAiPipeline.mockRejectedValue(new Error('down'));
    await render();
    expect(text()).toContain("Couldn't load the AI-sourced pipeline.");
  });
});

describe('money and changeOf', () => {
  it('shows amounts in the HubSpot currency, whole', () => {
    expect(money(12000.5, 'USD')).toBe('$12,001');
    expect(money(900, 'EUR')).toBe('€900');
    expect(money(900, null)).toBe('900');
    expect(money(900, 'ZZZZ')).toBe('900');
  });

  it('compares with the period before', () => {
    expect(changeOf(128, 108)).toEqual({ kind: 'up', pct: 19 });
    expect(changeOf(50, 100)).toEqual({ kind: 'down', pct: 50 });
    expect(changeOf(5, 5)).toEqual({ kind: 'same' });
    expect(changeOf(5, 0)).toEqual({ kind: 'new' });
    expect(changeOf(0, 0)).toBeNull();
    expect(changeOf(5, null)).toBeNull();
  });
});
