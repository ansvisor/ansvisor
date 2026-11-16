import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TeamRole } from '@/components/providers/role-provider';
import type { AdsAdDraft, AdsOpportunity, AdsOpportunityDetail } from '@/lib/ads/api';
import type { ChatPanelState } from '@/components/chat/panel/chat-panel-context';

/**
 * An opportunity's drawer (ADS-01 §3.2, §11), opened from the table's Open:
 * the row's decision and why, the latest answer per platform as quoted plain
 * text, fan-outs and seeds, no sponsored line without data, and closed by
 * ✕, the overlay or Esc with focus back on Open. The Earn card on Earn and
 * Earn + pay: what to fix, and Send to Action Center for Admins and Managers
 * where they can change the decision, then the action it made or found. The
 * Pay card's drafts and the primary button that follows the decision. The
 * footer's "Copy as campaign brief", for everyone, and Export this prompt.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const api = vi.hoisted(() => ({
  readAdsOpportunities: vi.fn(),
  readAdsOpportunity: vi.fn(),
  sendAdsEarn: vi.fn(),
  createAdsDrafts: vi.fn(),
  exportAdsOpportunity: vi.fn(),
  AdsApiError: class extends Error {},
}));
vi.mock('@/lib/ads/api', () => api);
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { AdsOpportunities } = await import('./_opportunities');
const { RoleProvider } = await import('@/components/providers/role-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { ChatPanelContext } = await import('@/components/chat/panel/chat-panel-context');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROW: AdsOpportunity = {
  promptId: 'p1',
  text: 'Best CRM for small teams',
  topic: null,
  decision: 'earn_pay',
  recommended: 'earn',
  override: { decision: 'earn_pay', setBy: 'u1', setAt: '2026-11-13T09:00:00Z' },
  leader: 'c1',
  leaderName: 'Kestrel',
  ourPosition: null,
  weNamed: false,
  weCited: false,
  volume: 14_000,
  estAiVolume: 6300,
  adChannels: ['chatgpt'],
  paidMeasured: false,
  reasons: [
    { code: 'rival_leads', competitorId: 'c1' },
    { code: 'volume_at_least', volume: 14_000, threshold: 1000 },
    { code: 'paid_not_measured', rivalPays: true, wePay: true },
    { code: 'a_later_code' },
  ],
};
const DETAIL: AdsOpportunityDetail = {
  promptId: 'p1',
  answers: [
    {
      platform: 'chatgpt-web',
      region: 'US',
      at: '2026-11-13T08:00:00Z',
      excerpt: 'Kestrel is the usual pick. <script>alert("x")</script> <b>Harbor</b> is cheaper.',
      mentionPosition: null,
      competitors: [
        { name: 'Kestrel', position: 1 },
        { name: 'Harbor', position: 2 },
      ],
      domains: ['g2.com', 'kestrel.example'],
    },
    {
      platform: 'google-aio',
      region: null,
      at: '2026-11-12T08:00:00Z',
      excerpt: 'Northwind is named second.',
      mentionPosition: 2,
      competitors: [],
      domains: [],
    },
  ],
  fanOuts: [{ query: 'best crm 2026', platform: 'google-aio' }],
  keywords: ['best crm', 'crm small team'],
  earn: { page: 'https://northwind.example/small-teams/', action: null },
  drafts: [],
  facts: [],
};

let container: HTMLDivElement;
let root: Root;
const panel = {
  available: true,
  open: false,
  fill: vi.fn(),
  toggle: vi.fn(),
  setup: { skills: [] },
};

/** The table with one row, for a role, where the plan writes (not the demo brand, Starter or the trial). */
async function mount(role: TeamRole = 'analyst', row = ROW, writable = true) {
  api.readAdsOpportunities.mockReset().mockResolvedValue({
    period: '30d',
    rows: [row],
    total: 1,
    locked: 0,
    notAnalysed: 0,
  });
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPanelContext.Provider value={panel as unknown as ChatPanelState}>
          <RoleProvider role={role}>
            <AdsOpportunities period="30d" writable={writable} thresholds={false} />
          </RoleProvider>
        </ChatPanelContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
async function remount(...args: Parameters<typeof mount>) {
  act(() => root.unmount());
  await mount(...args);
}

beforeEach(async () => {
  api.readAdsOpportunity.mockReset().mockResolvedValue(DETAIL);
  api.sendAdsEarn.mockReset();
  api.createAdsDrafts.mockReset();
  toast.error.mockReset();
  useBrandStore.setState({ brands: [], activeBrandId: 'b1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  await mount();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const openButton = () =>
  container.querySelector<HTMLButtonElement>('[data-action="ads.openOpportunity"]')!;
const drawer = () => document.querySelector<HTMLElement>('[data-slot="ads-drawer"]');
async function open() {
  await act(async () => {
    openButton().focus();
    openButton().click();
  });
  // Base UI moves focus into the drawer on the next frame.
  await act(() => new Promise<void>((frame) => requestAnimationFrame(() => frame())));
}

describe('AdsOpportunityDrawer', () => {
  it("shows the row's decision and why, then the latest answer per platform, fan-outs and seeds", async () => {
    await open();
    expect(api.readAdsOpportunity).toHaveBeenCalledWith('b1', 'p1', '30d');
    const d = drawer()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.querySelector('h2')?.textContent).toBe('Best CRM for small teams');
    expect(d.querySelector('[data-decision]')?.textContent).toBe('Earn + pay');
    expect(d.textContent).toContain('Recommended: Earn');
    // Each reason the rule gave, in words; a code it doesn't know yet, left out.
    expect([...d.querySelectorAll('ul[aria-label="Why"] li')].map((li) => li.textContent)).toEqual([
      'Kestrel leads the AI answer',
      '14,000 Google searches a month, at least 1,000',
      "Who pays isn't measured yet",
    ]);
    const answers = [...d.querySelectorAll('[data-slot="ads-answer"]')];
    expect(answers.map((a) => a.querySelector('p')?.textContent)).toEqual([
      'ChatGPT · United States · Nov 13, 2026',
      'Google AI Overviews · Nov 12, 2026',
    ]);
    expect(answers[0].textContent).toContain('You: not named · Names: Kestrel, Harbor');
    expect(answers[0].textContent).toContain('Cites: g2.com, kestrel.example');
    expect(answers[1].textContent).toContain('You: #2');
    expect(answers[1].textContent).not.toContain('Cites');
    expect(d.querySelector('[data-slot="ads-fanouts"]')?.textContent).toBe('best crm 2026');
    expect(d.querySelector('[data-slot="ads-keywords"]')?.textContent).toBe(
      'best crmcrm small team',
    );
  });

  it('renders the answer as quoted text: a <script> in it is only text', async () => {
    await open();
    const quote = drawer()!.querySelector('blockquote')!;
    expect(quote.textContent).toBe(DETAIL.answers[0].excerpt);
    expect(quote.children).toHaveLength(0);
    expect(
      document.querySelector('[data-slot="ads-drawer"] script, [data-slot="ads-drawer"] b'),
    ).toBeNull();
  });

  it('says nothing about sponsored units while none are stored, and never estimates one', async () => {
    await open();
    expect(drawer()!.textContent).not.toMatch(/sponsor|paid ad|estimated/i);
  });

  it('says so when there is no answer in the period, or the read fails', async () => {
    api.readAdsOpportunity.mockResolvedValue({ ...DETAIL, answers: [], fanOuts: [], keywords: [] });
    await open();
    expect(drawer()!.textContent).toContain('No AI answer on this prompt in this period yet.');
    expect(drawer()!.querySelector('[data-slot="ads-fanouts"]')).toBeNull();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );

    api.readAdsOpportunity.mockRejectedValue(new Error('Ads opportunities/p1: 500'));
    await open();
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toBe(
      "The answers couldn't be read. Close this and open it again.",
    );
  });

  it('keeps focus inside, closes with Esc, ✕ or the overlay, and gives focus back to Open', async () => {
    await open();
    expect(drawer()!.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('tr[data-prompt-id]')?.getAttribute('data-state')).toBe(
      'selected',
    );

    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());
    expect(container.querySelector('tr[data-prompt-id]')?.getAttribute('data-state')).toBeNull();

    const closers = () => [
      ...document.querySelectorAll<HTMLElement>('[data-action="drawer.close"]'),
    ];
    await open();
    expect(closers().map((el) => el.tagName)).toEqual(['DIV', 'BUTTON']);
    await act(async () => closers()[1].click());
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());

    await open();
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        closers()[0].dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
    });
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });
});

describe('the Earn card', () => {
  const card = () => drawer()?.querySelector<HTMLElement>('[data-slot="ads-earn"]') ?? null;
  const sendButton = () => card()?.querySelector<HTMLButtonElement>('[data-action="ads.earnTask"]');
  const opened = () => card()?.querySelector<HTMLAnchorElement>('[data-action="ads.openAction"]');

  it('says what to fix on Earn and Earn + pay only; an analyst sees no button', async () => {
    await open();
    expect(card()?.textContent).toBe(
      'Earn · fix the answerRefresh /small-teams to answer this prompt, so AI picks you over Kestrel.',
    );
    expect(sendButton()).toBeNull();
    for (const decision of ['pay', 'overlap'] as const) {
      await remount('manager', { ...ROW, decision });
      await open();
      expect(card(), decision).toBeNull();
    }
    api.readAdsOpportunity.mockResolvedValue({ ...DETAIL, earn: { page: null, action: null } });
    await remount('manager', { ...ROW, decision: 'earn', leader: 'none', reasons: [] });
    await open();
    expect(card()?.querySelector('p')?.textContent).toBe(
      'Write a page that answers this prompt, so AI has a page of yours to pick.',
    );
    expect(sendButton()?.textContent).toBe('Send to Action Center');
  });

  it('sends the fix once per card, then opens the action; one failure keeps the key', async () => {
    await remount('admin');
    await open();
    api.sendAdsEarn.mockRejectedValueOnce(new Error('Ads opportunities/p1/earn: 500'));
    await act(async () => sendButton()!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "The fix couldn't be sent to the Action Center. Try again.",
    );
    api.sendAdsEarn.mockResolvedValue({
      action: { id: 'a1', no: 1300 },
      created: true,
      covered: false,
    });
    await act(async () => sendButton()!.click());
    const [first, second] = api.sendAdsEarn.mock.calls;
    expect(first).toEqual(['b1', 'p1', expect.stringMatching(/^[\w-]{36}$/)]);
    expect(second).toEqual(first);
    expect(sendButton()).toBeNull();
    expect(opened()?.textContent).toBe('Sent · Open AC-1300');
    expect(opened()?.getAttribute('href')).toBe('/dashboard/action-center/actions?action=a1');
  });

  it('opens the action that already covers the prompt instead of sending another', async () => {
    api.readAdsOpportunity.mockResolvedValue({
      ...DETAIL,
      earn: { page: null, action: { id: 'a9', no: 1258 } },
    });
    await remount('manager');
    await open();
    expect(sendButton()).toBeNull();
    expect(opened()?.textContent).toBe('Open AC-1258');

    api.readAdsOpportunity.mockResolvedValue(DETAIL);
    api.sendAdsEarn.mockResolvedValue({
      action: { id: 'a9', no: 1258 },
      created: false,
      covered: true,
    });
    await remount('manager');
    await open();
    await act(async () => sendButton()!.click());
    expect(opened()?.textContent).toBe('Open AC-1258');
  });

  it("names the action by its brand's code once the brand is numbered", async () => {
    api.readAdsOpportunity.mockResolvedValue({
      ...DETAIL,
      earn: { page: null, action: { id: 'a9', no: 1258, brandNo: 3 } },
    });
    await remount('manager');
    await open();
    expect(opened()?.textContent).toBe('Open AC-03');

    api.readAdsOpportunity.mockResolvedValue(DETAIL);
    api.sendAdsEarn.mockResolvedValue({
      action: { id: 'a1', no: 1300, brandNo: 12 },
      created: true,
      covered: false,
    });
    await remount('manager');
    await open();
    await act(async () => sendButton()!.click());
    expect(opened()?.textContent).toBe('Sent · Open AC-12');
  });

  it('has no button on the demo brand, Starter or the trial, whatever the role', async () => {
    await remount('admin', ROW, false);
    await open();
    expect(card()).not.toBeNull();
    expect(sendButton()).toBeNull();
  });
});

describe('the Pay card and "Do both"', () => {
  const q = (action: string) => [
    ...(drawer()?.querySelectorAll<HTMLElement>(`[data-action="${action}"]`) ?? []),
  ];
  const click = (el: HTMLElement) => act(async () => el.click());
  const pay = () => drawer()?.querySelector<HTMLElement>('[data-slot="ads-pay"]') ?? null;
  const drafts = () => [
    ...(drawer()?.querySelectorAll<HTMLElement>('[data-slot="ads-draft"]') ?? []),
  ];
  const draft = (channel: AdsAdDraft['channel'], over: Partial<AdsAdDraft> = {}): AdsAdDraft => ({
    id: `d-${channel}`,
    channel,
    headlines: ['Pipeline live in one afternoon', 'Outlook <b>built in</b>'],
    descriptions: ['Set up in a day.'],
    contextHint: null,
    gate: { limits: 'unconfirmed' },
    ...over,
  });
  /** The API's refusal, as lib/ads/api.ts throws it. */
  const refused = (body: Record<string, unknown>) =>
    Object.assign(new api.AdsApiError(), { code: body.code, body });
  beforeEach(() => {
    api.sendAdsEarn.mockResolvedValue({
      action: { id: 'a1', no: 7 },
      created: true,
      covered: false,
    });
    api.createAdsDrafts.mockResolvedValue({ created: true, drafts: [draft('google')] });
    panel.fill.mockReset();
    panel.toggle.mockReset();
    panel.setup.skills = [];
  });

  it('§9.4: the primary button follows the decision, and does only its half', async () => {
    for (const [decision, label, calls] of [
      ['earn', 'Send to Action Center', [1, 0]],
      ['pay', 'Create ad drafts', [0, 1]],
    ] as const) {
      api.sendAdsEarn.mockClear();
      api.createAdsDrafts.mockClear();
      await remount('manager', { ...ROW, decision });
      await open();
      expect(q('ads.doBoth').map((b) => b.textContent)).toEqual([label]);
      await click(q('ads.doBoth')[0]);
      expect([api.sendAdsEarn.mock.calls.length, api.createAdsDrafts.mock.calls.length]).toEqual(
        calls,
      );
      // Done: nothing is left for it to do.
      expect(q('ads.doBoth')).toEqual([]);
    }
    await remount('manager', { ...ROW, decision: 'overlap' });
    await open();
    expect(q('ads.doBoth')).toEqual([]);
    expect(pay()).toBeNull();
  });

  it('"Do both" sends the task and creates the drafts, each with its own key; nothing else goes out', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    await remount('admin');
    await open();
    expect(q('ads.doBoth')[0].textContent).toBe('Do both');
    await click(q('ads.doBoth')[0]);
    const [[, , earnKey]] = api.sendAdsEarn.mock.calls;
    expect(api.createAdsDrafts.mock.calls).toEqual([['b1', 'p1', expect.any(String)]]);
    expect(api.createAdsDrafts.mock.calls[0][2]).not.toBe(earnKey);
    // Read again once the drafts are made, for the facts they rest on.
    expect(api.readAdsOpportunity).toHaveBeenCalledTimes(2);
    // The two Ads routes only (lib/ads/api.test.ts), and no other request: no ad platform.
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
    expect(q('ads.openAction')[0].textContent).toBe('Sent · Open AC-7');
    expect(drafts()).toHaveLength(1);
    expect(q('ads.doBoth')).toEqual([]);
  });

  it('says which half failed, and retries only that half with its key', async () => {
    api.createAdsDrafts.mockRejectedValueOnce(refused({ code: 'gate_failed' }));
    await remount('manager');
    await open();
    await click(q('ads.doBoth')[0]);
    expect(drawer()!.querySelector('[data-slot="ads-do-both"] [role="status"]')?.textContent).toBe(
      "The task is in the Action Center, but the ad drafts weren't written.",
    );
    expect(pay()!.querySelector('[role="alert"]')?.textContent).toBe(
      'No draft passed the claims check. Try again for new drafts.',
    );
    expect(q('ads.doBoth')[0].textContent).toBe('Retry the ad drafts');
    await click(q('ads.doBoth')[0]);
    expect(api.sendAdsEarn).toHaveBeenCalledTimes(1);
    const [first, second] = api.createAdsDrafts.mock.calls;
    expect(second).toEqual(first);
    expect(drafts()).toHaveLength(1);
  });

  it('asks for approved facts, says when they are off here, and gives the AI budget message', async () => {
    api.createAdsDrafts
      .mockRejectedValueOnce(refused({ code: 'facts_needed', why: 'none' }))
      .mockRejectedValueOnce(refused({ code: 'facts_needed', why: 'off' }))
      .mockRejectedValueOnce(refused({ code: 'ai_budget' }));
    await remount('manager', { ...ROW, decision: 'pay' });
    await open();
    const alert = () => pay()!.querySelector('[role="alert"]')?.textContent;
    expect(q('ads.createDrafts')[0].textContent).toBe('Create ad drafts');
    await click(q('ads.createDrafts')[0]);
    expect(alert()).toBe(
      'Approve your brand facts first: ad drafts only state facts you approved.',
    );
    expect(q('ads.openBrandFacts')[0].getAttribute('href')).toBe(
      '/dashboard/brands/b1/settings?tab=facts',
    );
    await click(q('ads.createDrafts')[0]);
    expect(alert()).toBe("Brand facts aren't available here, so ad drafts can't be written.");
    expect(q('ads.openBrandFacts')).toEqual([]);
    await click(q('ads.createDrafts')[0]);
    expect(alert()).toBe(
      "This month's AI usage is spent, so no ad drafts were written. Try again once it resets.",
    );
    expect(q('ads.createDrafts')[0].textContent).toBe('Try again');
  });

  it('shows each draft as plain text with its gate result; scroll, Copy and Edit', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    api.readAdsOpportunity.mockResolvedValue({
      ...DETAIL,
      drafts: [
        draft('chatgpt', { contextHint: 'Asked for a CRM' }),
        draft('google', { gate: { limits: 'confirmed' } }),
      ],
    });
    await remount('admin');
    await open();
    const [chatgpt, google] = drafts();
    expect(chatgpt.textContent).toContain('ChatGPT · contextual');
    expect(chatgpt.textContent).toContain(
      'Pipeline live in one afternoon | Outlook <b>built in</b>',
    );
    expect(chatgpt.textContent).toContain('Fits when: Asked for a CRM');
    expect(pay()!.querySelector('b')).toBeNull();
    expect(drafts().map((d) => d.querySelector('[data-slot="ads-gate"]')?.textContent)).toEqual([
      'Claims checked against your brand facts · Character limits not confirmed yet',
      'Claims checked against your brand facts',
    ]);
    expect(q('ads.createDrafts')).toEqual([]);

    await click(q('ads.scrollAds')[1]);
    expect(scrolled.mock.contexts).toEqual([google]);
    await click(q('ads.copyAd')[0]);
    const text = 'Pipeline live in one afternoon\nOutlook <b>built in</b>\nSet up in a day.';
    expect(writeText).toHaveBeenCalledWith(text);

    // No /ad-drafts skill yet: a plain request, and the drawer makes way for the panel.
    await click(q('ads.editAd')[1]);
    expect(panel.fill).toHaveBeenCalledWith(
      `Rewrite the Google ad draft for "Best CRM for small teams" using only my approved brand facts:\n\n${text}`,
    );
    expect(panel.toggle).toHaveBeenCalled();
    expect(drawer()).toBeNull();
    panel.setup.skills = [{ name: 'ad-drafts', title: 'Ad drafts' }] as never;
    await open();
    await click(q('ads.editAd')[0]);
    expect(panel.fill.mock.lastCall?.[0]).toMatch(/^\/ad-drafts Rewrite the ChatGPT ad draft/);
  });

  it("asks Chat with /ad-drafts once Ads is on, as the / menu then lists Chat's skill (PR 15)", async () => {
    const { enabledSkills } = await import('@/lib/chat/skills/library');
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    api.readAdsOpportunity.mockResolvedValue({ ...DETAIL, drafts: [draft('google')] });
    for (const [ads, slash] of [
      ['', false],
      ['true', true],
    ] as const) {
      vi.stubEnv('ADS_ENABLED', ads);
      // The panel's skills, as the dashboard's layout reads them (skillMenuFor).
      panel.setup.skills = enabledSkills('org-1').map(({ name, title }) => ({
        name,
        title,
      })) as never;
      await remount('manager');
      await open();
      await click(q('ads.editAd')[0]);
      expect(panel.fill.mock.lastCall?.[0].startsWith('/ad-drafts Rewrite'), ads).toBe(slash);
    }
    panel.setup.skills = [];
    vi.unstubAllEnvs();
  });

  it('is read-only for an analyst and on the demo brand, Starter or the trial: Copy and the brief only', async () => {
    for (const [role, writable] of [
      ['analyst', true],
      ['admin', false],
    ] as const) {
      api.readAdsOpportunity.mockResolvedValue({ ...DETAIL, drafts: [draft('google')] });
      await remount(role, ROW, writable);
      await open();
      expect(q('ads.copyAd')).toHaveLength(1);
      expect(q('ads.copyBrief')).toHaveLength(1);
      for (const action of [
        'ads.editAd',
        'ads.createDrafts',
        'ads.earnTask',
        'ads.doBoth',
        'ads.exportOne',
      ]) {
        expect(q(action), `${role} ${action}`).toEqual([]);
      }
      api.readAdsOpportunity.mockResolvedValue(DETAIL);
      await remount(role, ROW, writable);
      await open();
      expect(pay()!.textContent).toBe('Pay · win it nowNo ad drafts for this prompt yet.');
    }
  });
});

describe('the footer: Export this prompt and "Copy as campaign brief"', () => {
  const q = (action: string) => [
    ...(drawer()?.querySelectorAll<HTMLElement>(`[data-action="${action}"]`) ?? []),
  ];
  const click = (el: HTMLElement) => act(async () => el.click());
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  beforeEach(() => {
    for (const fn of [writeText, toast.success, api.exportAdsOpportunity, download.saveBlob]) {
      fn.mockReset();
    }
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('exports this prompt for Admins and Managers, saved as the server names it', async () => {
    const file = { fileName: 'prompt-p1.csv', csv: 'Campaign', rowCount: 3, prompts: 1 };
    api.exportAdsOpportunity.mockResolvedValue({ ...file, droppedUrls: 1 });
    await remount('manager');
    await open();
    expect(q('ads.exportOne')[0].textContent).toBe('Export this prompt');
    await click(q('ads.exportOne')[0]);
    expect(api.exportAdsOpportunity).toHaveBeenCalledWith('b1', 'p1', '30d');
    expect(download.saveBlob).toHaveBeenCalledWith(expect.any(Blob), file.fileName);
    expect(toast.success).toHaveBeenCalledWith('Exported 3 rows from 1 prompt', {
      description: '1 link outside your domains was replaced with your home page',
    });
  });

  it('copies the brief as plain text, for an analyst too: decision, why, seeds, fan-outs, drafts, facts', async () => {
    api.readAdsOpportunity.mockResolvedValue({
      ...DETAIL,
      drafts: [
        {
          id: 'd1',
          channel: 'chatgpt',
          headlines: ['Pipeline live in one afternoon'],
          descriptions: ['Set up in a day, Outlook sync included.'],
          contextHint: 'Asked for a CRM for a small team',
          gate: { limits: 'unconfirmed' },
        },
        {
          id: 'd2',
          channel: 'google',
          headlines: ['Northwind CRM', 'Live in one afternoon'],
          descriptions: ['Set up in a day.', 'Outlook sync included.'],
          contextHint: null,
          gate: {},
        },
      ],
      facts: [
        {
          id: 'f1',
          quote: 'Teams set up in one afternoon.',
          sourceUrl: 'https://nw.example/setup',
        },
        { id: 'f2', quote: 'Two-way Outlook sync', sourceUrl: 'https://nw.example/outlook' },
      ],
    });
    await remount('analyst');
    await open();
    await click(q('ads.copyBrief')[0]);
    const brief = writeText.mock.lastCall?.[0] ?? '';
    expect(brief).toBe(`Prompt: Best CRM for small teams
Decision: Earn + pay (recommended: Earn)

Why:
• Kestrel leads the AI answer
• 14,000 Google searches a month, at least 1,000
• Who pays isn't measured yet

Keyword seeds:
• best crm
• crm small team

Fan-out queries:
• best crm 2026

Ad draft: ChatGPT · contextual
Headline 1: Pipeline live in one afternoon
Description 1: Set up in a day, Outlook sync included.
Fits when: Asked for a CRM for a small team

Ad draft: Google · search, eligible for AI Overviews and AI Mode
Headline 1: Northwind CRM
Headline 2: Live in one afternoon
Description 1: Set up in a day.
Description 2: Outlook sync included.

Facts used:
• "Teams set up in one afternoon." Source: https://nw.example/setup
• "Two-way Outlook sync" Source: https://nw.example/outlook`);
    // No markdown or HTML: no heading, list, quote or table marks, emphasis, code, links or tags.
    expect(brief).not.toMatch(/^\s*(#|[-*+] |>|\|)/m);
    expect(brief).not.toMatch(/\*\*|__|`|\]\(|<\/?[a-z]/i);
    expect(toast.success).toHaveBeenCalledWith('Campaign brief copied');
  });
});
