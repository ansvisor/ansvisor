import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { AiUsage } from '@/lib/billing/ai-usage';
import type { ChatMode } from '@/lib/chat/precedence';
import { composerKeyAction } from './composer-keys';

/**
 * Chat's composer (W1-10, CHAT-02): send, Stop and steering, the run mode
 * with Full auto's plan lock, and the read-only composer of Analysts and
 * Agency partners.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => router,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
const requestAccess = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess }));
const aiUsage = vi.hoisted(() => ({ usage: null as AiUsage | null }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: aiUsage.usage, refresh: () => {} }),
}));

const { ChatComposer } = await import('./chat-composer');
const { useChatRangeStore } = await import('../range/use-chat-range');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const handlers = {
  onSend: vi.fn(),
  onStop: vi.fn(),
  onSteer: vi.fn(),
  onModeChange: vi.fn(),
};

async function render(
  props: Partial<Parameters<typeof ChatComposer>[0]> = {},
  role: TeamRole = 'admin',
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <ChatComposer
            mode={'auto' as ChatMode}
            fullAutoOpen
            onSend={handlers.onSend}
            onModeChange={handlers.onModeChange}
            {...props}
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const box = () => container.querySelector('textarea')!;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const modeButton = () =>
  container.querySelector<HTMLButtonElement>('[data-action="composer.openMode"]');
// The menu opens in a portal, outside the composer.
const modeItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
// The box's row: ＋ / @ on the left, the microphone and Send on the right.
const boxRow = () => container.querySelector<HTMLElement>('[data-slot="composer-controls"]')!;
// The line under the box: the run's status on the left, the mode and the model on the right.
const underLine = () => container.querySelector<HTMLElement>('[data-slot="composer-under"]')!;
const settings = () => container.querySelector<HTMLElement>('[data-slot="composer-settings"]')!;
// The status on that line; empty while there's nothing to say.
const under = () => container.querySelector('[data-slot="composer-status"]')?.textContent ?? '';

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

beforeEach(() => {
  Object.values(handlers).forEach((fn) => fn.mockReset());
  toast.mockReset();
  aiUsage.usage = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('composerKeyAction', () => {
  const key = (over: Partial<Parameters<typeof composerKeyAction>[0]>) =>
    composerKeyAction({
      key: 'Enter',
      shiftKey: false,
      composing: false,
      coarse: false,
      running: false,
      hasText: true,
      canSteer: true,
      ...over,
    });

  it('sends on Enter, and leaves Shift+Enter, an input method’s Enter and a touch screen’s to the box', () => {
    expect(key({})).toBe('send');
    expect(key({ shiftKey: true })).toBeNull();
    expect(key({ composing: true })).toBeNull();
    expect(key({ coarse: true })).toBeNull();
    expect(key({ hasText: false })).toBe('block');
    expect(key({ key: 'a' })).toBeNull();
  });

  it('steers on Enter while a run answers, and stops it on Esc', () => {
    expect(key({ running: true })).toBe('steer');
    expect(key({ running: true, canSteer: false })).toBe('block');
    expect(key({ key: 'Escape', running: true })).toBe('stop');
    expect(key({ key: 'Escape' })).toBeNull();
    // A run waiting on a question: Enter answers, Esc stops it.
    expect(key({ stoppable: true })).toBe('send');
    expect(key({ key: 'Escape', stoppable: true })).toBe('stop');
  });

  it('takes a ghost suggestion in on Tab only in an empty box', () => {
    expect(key({ key: 'Tab', ghost: true, hasText: false })).toBe('accept');
    expect(key({ key: 'Tab', ghost: true, hasText: true })).toBeNull();
    expect(key({ key: 'Tab', ghost: true, hasText: false, shiftKey: true })).toBeNull();
    expect(key({ key: 'Tab', hasText: false })).toBeNull();
    // Only the ghost shows: Enter sends nothing.
    expect(key({ ghost: true, hasText: false })).toBe('block');
  });
});

describe('ChatComposer', () => {
  it('sends the text on Enter and clears the box; Shift+Enter and an empty box send nothing', async () => {
    await render();
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();

    await type('  Why did our citations drop?  ');
    expect(button('Send')!.disabled).toBe(false);
    await press('Enter', { shiftKey: true });
    expect(handlers.onSend).not.toHaveBeenCalled();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Why did our citations drop?', {
      context: [],
      references: [],
      attachments: [],
    });
    expect(box().value).toBe('');
  });

  it('puts the text back when the send is refused', async () => {
    handlers.onSend.mockResolvedValue(false);
    await render();
    await type('Open Citations');
    await act(async () => button('Send')!.click());
    expect(box().value).toBe('Open Citations');
  });

  it('turns Send into Stop while a run answers, and steers with what is typed', async () => {
    await render({ running: true, onStop: handlers.onStop, onSteer: handlers.onSteer });
    expect(button('Send')).toBeNull();
    expect(box().placeholder).toBe('Steer while I work: “only blog pages”…');
    expect(under()).toContain('Answering · Esc to stop');

    await act(async () => button('Stop')!.click());
    await press('Escape');
    expect(handlers.onStop).toHaveBeenCalledTimes(2);

    await type('only blog pages');
    expect(under()).toContain('Enter stops this run and sends your message');
    await press('Enter');
    expect(handlers.onSteer).toHaveBeenCalledExactlyOnceWith('only blog pages', {
      context: [],
      references: [],
      attachments: [],
    });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('answers a question with Send, Stop beside it and Esc, up to the answer’s length', async () => {
    await render({ answering: true, maxLength: 500, onStop: handlers.onStop });
    expect(under()).toContain("Your message answers Chat's question · Esc stops the run");
    expect(box().maxLength).toBe(500);
    await act(async () => button('Stop')!.click());
    await press('Escape');
    expect(handlers.onStop).toHaveBeenCalledTimes(2);
    await type('The blog');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledWith('The blog', expect.anything());
    expect(button('Send')).not.toBeNull();
  });

  it('waits for the run on Enter when the page doesn’t steer', async () => {
    await render({ running: true, onStop: handlers.onStop });
    await type('only blog pages');
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('only blog pages');
  });

  it('puts the run mode under the box by its short name, as a menu that says what each pick does, and locks Full auto below Growth', async () => {
    await render({ fullAutoOpen: false });
    const open = modeButton()!;
    expect(open.textContent).toBe('Ask before changes ▾');
    expect(open.getAttribute('aria-label')).toBe('Run mode: Auto, ask before changes');
    expect(open.getAttribute('aria-haspopup')).toBe('menu');
    // On the line under the box, not in the box's row with Send; no status while idle.
    expect(settings().contains(open)).toBe(true);
    expect(boxRow().contains(open)).toBe(false);
    expect(under()).toBe('');
    expect(modeItems()).toHaveLength(0);

    await act(async () => open.click());
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Run mode');
    expect(modeItems().map((r) => r.textContent)).toEqual([
      'Ask me first',
      'Auto, ask before changes',
      'Full autoNeeds Growth',
    ]);
    expect(modeItems().map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);

    const fullAuto = modeItems()[2];
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    expect(fullAuto.getAttribute('title')).toBe(
      'Full auto · Needs Growth: agents apply changes for you, logged and undoable',
    );
    await act(async () => fullAuto.click());
    expect(handlers.onModeChange).not.toHaveBeenCalled();

    await act(async () => modeItems()[0].click());
    expect(handlers.onModeChange).toHaveBeenCalledExactlyOnceWith('ask_first');
    expect(toast).toHaveBeenCalledWith('Ask me first: the agent asks before every step.');
  });

  it('opens Full auto on Growth, with its toast', async () => {
    await render({ fullAutoOpen: true });
    await act(async () => modeButton()!.click());
    expect(modeItems()[2].getAttribute('aria-disabled')).toBeNull();
    await act(async () => modeItems()[2].click());
    expect(handlers.onModeChange).toHaveBeenCalledWith('full_auto');
    expect(toast).toHaveBeenCalledWith(
      'Full auto: the agent makes changes without asking. Nothing is published or sent without your click. Every change is in the Activity log.',
    );
  });

  it('names the mode the chat is in on the menu’s button', async () => {
    await render({ mode: 'full_auto' });
    expect(modeButton()!.textContent).toBe('Full auto ▾');
    await render({ mode: 'ask_first' });
    expect(modeButton()!.textContent).toBe('Ask me first ▾');
  });

  it('keeps only ＋ / @ and the microphone and Send in the box’s row, in every composer', async () => {
    for (const variant of ['home', 'dock', 'panel'] as const) {
      await render({ variant, fullAutoOpen: false });
      const row = boxRow();
      expect(row.closest('[data-slot="composer-box"]')).not.toBeNull();
      expect(row.className).not.toContain('flex-wrap');
      const group = button('Send')!.parentElement!;
      expect(group.getAttribute('data-slot')).toBe('composer-send-group');
      expect(group.className).toContain('shrink-0');
      expect(group.className).toContain('ml-auto');
      expect(group.lastElementChild).toBe(button('Send'));
      expect(
        [...row.children].map(
          (el) => el.getAttribute('data-action') ?? el.getAttribute('data-slot'),
        ),
      ).toEqual([
        'composer.openPlus',
        'composer.openSlash',
        'composer.openRef',
        'composer-send-group',
      ]);
      expect(row.querySelector('[data-action="composer.openMode"]')).toBeNull();
      expect(row.querySelector('[data-slot="composer-model"]')).toBeNull();
    }
  });

  it('puts the mode and the model on one line under the box, on the left, by their full labels, then the status (owner’s changes after testing it live)', async () => {
    for (const variant of ['home', 'dock', 'panel'] as const) {
      await render({
        variant,
        modelChoice: { model: 'auto', effort: 'normal' },
        onModelChoice: vi.fn(),
      });
      const line = underLine();
      // After the box, its next sibling: chips above, the box, then this line.
      expect(line.previousElementSibling!.getAttribute('data-slot')).toBe('composer-box');
      expect([...line.children].map((el) => el.getAttribute('data-slot'))).toEqual([
        'composer-settings',
        'composer-status',
      ]);
      // Nothing pushes them right: the status after them reads from the left too.
      expect(line.className).not.toContain('justify-end');
      expect(container.querySelector('[data-slot="composer-status"]')!.className).not.toContain(
        'text-right',
      );
      expect(
        [...settings().children].map(
          (el) => el.getAttribute('data-action') ?? el.getAttribute('data-slot'),
        ),
      ).toEqual(['composer.openMode', 'composer-model']);
      // The whole names, never cut: no truncation and no cap on the mode's width.
      const mode = modeButton()!;
      expect(mode.textContent).toBe('Ask before changes ▾');
      expect(mode.querySelector('.truncate')).toBeNull();
      expect(mode.className).toContain('shrink-0');
      expect(mode.className).toContain('whitespace-nowrap');
      const model = button('Model')!;
      expect(model.textContent).toBe('Auto ▾');
      expect(model.className).not.toMatch(/max-w-/);
      expect(model.className).toContain('whitespace-nowrap');
      // The status takes what the buttons leave: they keep their room.
      expect(container.querySelector('[data-slot="composer-status"]')!.className).toContain(
        'flex-1',
      );
    }
  });

  it('keeps the line under the box the same height and the same nodes as a run starts and ends', async () => {
    const props = { onStop: handlers.onStop, onSteer: handlers.onSteer, ghost: 'Show the pages' };
    await render(props);
    const line = underLine();
    const status = container.querySelector('[data-slot="composer-status"]')!;
    const settled = [...line.children];
    // A fixed 28px line; the status at most two 14px lines, so it never grows it.
    expect(line.className).toContain('h-7');
    expect(status.className).toContain('line-clamp-2');
    expect(status.className).toContain('leading-[14px]');
    const says: string[] = [under()];
    for (const state of [{ running: true }, { answering: true }, {}] as const) {
      await render({ ...props, ...state });
      // The same line and the same status, its text changed in place.
      expect(underLine()).toBe(line);
      expect([...line.children]).toEqual(settled);
      expect(line.className).toContain('h-7');
      says.push(under());
    }
    expect(says).toEqual([
      'Tab to accept · / skills · @ data',
      'Answering · Esc to stop',
      "Your message answers Chat's question · Esc stops the run",
      'Tab to accept · / skills · @ data',
    ]);
    // A long status is cut at two lines, the whole of it in the tooltip.
    await render({ ...props, answering: true });
    expect(status.getAttribute('title')).toBe(
      "Your message answers Chat's question · Esc stops the run",
    );
  });

  it('keeps Stop and Send together on the right while a question waits', async () => {
    await render({ answering: true, onStop: handlers.onStop });
    const group = button('Send')!.parentElement!;
    expect([...group.children].map((el) => el.getAttribute('data-action'))).toEqual([
      'composer.stop',
      'composer.send',
    ]);
  });

  it('reads only for an Analyst or an Agency partner: no mode, a link to what they can do', async () => {
    for (const [role, name] of [
      ['analyst', 'Analyst'],
      ['agency_partner', 'Agency partner'],
    ] as const) {
      await render({}, role);
      expect(modeButton()).toBeNull();
      const link = container.querySelector('a')!;
      expect(link.textContent).toBe(`Read-only · ${name}`);
      expect(link.getAttribute('href')).toBe('/dashboard/chat/capabilities');
      // Where the mode is for others: first on the line under the box; the box says @ data, no skills.
      expect(settings().firstElementChild).toBe(link);
      expect(link.className).toContain('whitespace-nowrap');
      expect(box().placeholder).toBe('Ask anything · @ data');
      expect(under()).toBe('');
    }
    // A manager changes things: the mode is there.
    await render({}, 'manager');
    expect(modeButton()).not.toBeNull();
  });

  it('starts Chat home’s box at two rows, the others at one', async () => {
    await render({ variant: 'home' });
    expect(box().rows).toBe(2);
    await render({ variant: 'panel' });
    expect(box().rows).toBe(1);
  });

  it('shows the model on Auto, short, on the line under the box', async () => {
    await render();
    expect(settings().querySelector('[data-slot="composer-model"]')!.textContent).toBe('Auto');
  });

  it('puts the / and @ hint in the placeholder, not under the box', async () => {
    await render();
    expect(box().placeholder).toBe('Ask anything · / skills · @ data');
    expect(under()).toBe('');
    await render({ placeholder: 'Make the intro shorter' });
    expect(box().placeholder).toBe('Make the intro shorter · / skills · @ data');
    // A run answering, or the box off at the limit: its own line alone.
    await render({ running: true });
    expect(box().placeholder).toBe('Steer while I work: “only blog pages”…');
    await render({ disabled: true, placeholder: 'Your trial AI limit is used up' });
    expect(box().placeholder).toBe('Your trial AI limit is used up');
  });

  it('marks the model button from 80% of the AI usage, amber, then red once used up', async () => {
    const usage = (percentUsed: number): AiUsage => ({
      plan: 'growth',
      planName: 'Growth',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      unlimited: false,
      percentUsed,
      features: [],
      chatMetered: true,
    });
    const props = {
      modelChoice: { model: 'auto', effort: 'normal' } as const,
      onModelChoice: vi.fn(),
    };
    const dot = () => container.querySelector<HTMLElement>('[data-slot="model-usage-dot"]');
    aiUsage.usage = usage(42);
    await render(props);
    expect(dot()).toBeNull();
    expect(button('Model')!.textContent).toBe('Auto ▾');

    aiUsage.usage = usage(84.6);
    await render(props);
    expect(dot()!.dataset.tone).toBe('warning');
    const warned = container.querySelector<HTMLButtonElement>('[data-action="model.openMenu"]')!;
    expect(warned.getAttribute('aria-label')).toBe(
      'Model · AI 84.6% used this month, close to the limit',
    );
    expect(warned.textContent).toBe('Auto ▾');

    aiUsage.usage = usage(100);
    await render(props);
    expect(dot()!.dataset.tone).toBe('exhausted');
  });

  it('names the chat’s model and effort on the model button, and opens the model menu (W4-02)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false })));
    vi.stubGlobal('fetch', fetchMock);
    const onModelChoice = vi.fn();
    await render({
      modelChoice: { model: 'anthropic/claude-sonnet-5.5', effort: 'high' },
      onModelChoice,
    });
    const open = button('Model')!;
    expect(open.textContent).toBe('Sonnet 5.5 · High ▾');
    await act(async () => open.click());
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-slot="model-menu"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/models?selected=anthropic%2Fclaude-sonnet-5.5',
    );
    vi.unstubAllGlobals();

    await render({ modelChoice: { model: 'auto', effort: 'normal' }, onModelChoice });
    expect(button('Model')!.textContent).toBe('Auto ▾');
  });
});

describe('ChatComposer: a pasted API key (W4-05)', () => {
  const KEY = `sk-proj-${'Xy9_'.repeat(12)}`;
  const keyLine = () => container.querySelector('[data-slot="composer-key-paste"]');
  const action = (name: string) =>
    container.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

  it('never sends text that holds a key: the line says why, and Remove takes the key out', async () => {
    await render();
    await type(`Use my OpenAI key ${KEY}`);
    expect(keyLine()?.textContent).toContain(
      'This looks like an API key. Save it securely instead of sending it?',
    );
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    // Save securely waits for the page's key form.
    expect(action('composer.saveKey')).toBeNull();

    await act(async () => action('composer.removeKey')!.click());
    expect(box().value).toBe('Use my OpenAI key');
    expect(keyLine()).toBeNull();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Use my OpenAI key', expect.anything());
  });

  it('steers no key into a running run either', async () => {
    await render({ running: true, onSteer: handlers.onSteer, onStop: handlers.onStop });
    await type(KEY);
    await press('Enter');
    expect(handlers.onSteer).not.toHaveBeenCalled();
    expect(handlers.onStop).not.toHaveBeenCalled();
    expect(keyLine()).not.toBeNull();
  });

  it('hands the text to the page’s key form on Save securely, where the page offers it', async () => {
    const onSaveKey = vi.fn();
    await render({ onSaveKey });
    await type(`key ${KEY}`);
    await act(async () => action('composer.saveKey')!.click());
    expect(onSaveKey).toHaveBeenCalledExactlyOnceWith(`key ${KEY}`);
    expect(handlers.onSend).not.toHaveBeenCalled();
  });
});

describe('ChatComposer: context chips and the ghost suggestion (W1-11)', () => {
  const chips = [
    { key: 'brand', label: 'Ansvisor' },
    { key: 'range', label: 'Last 30 days' },
    { key: 'prompt', label: 'Best AI search visibility tools for small agencies' },
  ];
  const ghost = 'Why did our Perplexity citations drop this week?';
  const chipTexts = () =>
    [...container.querySelectorAll('[data-action="composer.removeChip"]')].map(
      (b) => b.parentElement!.textContent,
    );

  it('shows the chips by name, cuts a long one with the whole name in its tooltip, and sends them', async () => {
    const onRemoveChip = vi.fn();
    await render({ chips, onRemoveChip });
    expect(chipTexts()).toEqual(['Ansvisor×', 'Last 30 days×', 'Best AI search visibility t…×']);
    const long = container.querySelectorAll('[data-action="composer.removeChip"]')[2];
    // In one row above the box, outside it, each with a small icon.
    const row = container.querySelector('[data-slot="composer-context"]')!;
    expect(row.contains(long)).toBe(true);
    expect(row.contains(box())).toBe(false);
    expect(row.nextElementSibling!.contains(box())).toBe(true);
    expect(long.parentElement!.querySelector('svg')).not.toBeNull();
    expect(long.parentElement!.getAttribute('title')).toBe(chips[2].label);
    expect(long.getAttribute('aria-label')).toBe(`Remove ${chips[2].label}`);
    await act(async () => (long as HTMLButtonElement).click());
    expect(onRemoveChip).toHaveBeenCalledExactlyOnceWith('prompt');

    await type('What changed?');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('What changed?', {
      context: chips,
      references: [],
      attachments: [],
    });
  });

  it("hides the person's own range beside a page's dates, which Chat reads instead", async () => {
    const before = useChatRangeStore.getState().state;
    useChatRangeStore.setState({ state: { range: '30d', available: true } });
    try {
      const range = () => container.querySelector('[data-slot="composer-range"]');
      await render({ chips: [{ key: 'page', label: 'Citations' }] });
      expect(range()?.textContent).toBe('Last 30 days×');
      await render({
        chips: [
          { key: 'page', label: 'Citations' },
          { key: 'dates', label: 'Last 24 hours' },
        ],
      });
      expect(range()).toBeNull();
      const row = container.querySelector('[data-slot="composer-context"]')!;
      expect(row.textContent).toBe('CitationsLast 24 hours');
    } finally {
      useChatRangeStore.setState({ state: before });
    }
  });

  it('takes a page’s hand-off once: a question in the box, unsent, or an object as an @ chip (W1-08)', async () => {
    const chart = { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' };
    await render({ draft: { nonce: 1, text: 'Turn this page into actions' } });
    expect(box().value).toBe('Turn this page into actions');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box());

    await render({ draft: { nonce: 2, reference: chart } });
    expect(chipTexts()).toEqual(['Mentions over time×']);
    // The same hand-off again is not taken twice.
    await render({ draft: { nonce: 2, reference: chart } });
    await render({ draft: { nonce: 3, reference: chart } });
    expect(chipTexts()).toEqual(['Mentions over time×']);

    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Turn this page into actions', {
      context: [],
      references: [chart],
      attachments: [],
    });
  });

  it('keeps the focus in the composer when a chip is removed from the keyboard', async () => {
    let shownChips = chips;
    const onRemoveChip = vi.fn((key: string) => {
      shownChips = shownChips.filter((c) => c.key !== key);
    });
    await render({ chips, onRemoveChip });
    const remove = container.querySelectorAll<HTMLButtonElement>(
      '[data-action="composer.removeChip"]',
    )[0];
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => remove.click());
    expect(onRemoveChip).toHaveBeenCalledExactlyOnceWith('brand');
    await render({ chips: shownChips, onRemoveChip });
    expect(document.activeElement).toBe(box());
  });

  it('shows one ghost suggestion in the empty box; Tab makes it the text, and nothing sends by itself', async () => {
    await render({ ghost });
    const shown = () => container.querySelector('[data-action="composer.acceptGhost"]');
    expect(shown()!.textContent).toBe(`${ghost}Tab`);
    expect(under()).toContain('Tab to accept · / skills · @ data');
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();

    await press('Tab');
    expect(box().value).toBe(ghost);
    expect(shown()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith(ghost, {
      context: [],
      references: [],
      attachments: [],
    });
  });

  it('gives way to typing, comes back on an empty box, and fills the box on a click', async () => {
    await render({ ghost });
    const shown = () =>
      container.querySelector<HTMLElement>('[data-action="composer.acceptGhost"]');
    await type('O');
    expect(shown()).toBeNull();
    expect(box().value).toBe('O');
    await type('');
    expect(shown()).not.toBeNull();
    await act(async () => shown()!.click());
    expect(box().value).toBe(ghost);
  });

  it('shows no ghost while a run answers', async () => {
    await render({ ghost, running: true, onStop: handlers.onStop });
    expect(container.querySelector('[data-action="composer.acceptGhost"]')).toBeNull();
    expect(box().placeholder).toBe('Steer while I work: “only blog pages”…');
  });
});

describe('ChatComposer: the / @ ＋ menus (W1-12)', () => {
  // A row's words, without its mark (aria-hidden).
  const options = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].map((o) => {
      const copy = o.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden]').forEach((mark) => mark.remove());
      return copy.textContent;
    });
  const listbox = () => document.querySelector('[role="listbox"]');
  // CHAT-08's shortcuts, as the / menu lists them (W2-09).
  const ALL_SHORTCUTS = [
    '/startGet started',
    '/analyzeAnalyze',
    '/new-reportReports',
    '/createCreate content',
    '/optimizeOptimize content',
    '/opportunitiesFind opportunities',
    '/auditImprove with audit',
    '/imageCreate image',
  ];

  it('lists the shortcuts on "/" first in an empty box, filters them, and fills the starter on Enter', async () => {
    await render();
    await type('/');
    expect(listbox()!.getAttribute('aria-label')).toBe('Skills and shortcuts');
    expect(options()).toEqual(ALL_SHORTCUTS);

    await type('/re');
    expect(options()).toEqual(['/new-reportReports']);
    await press('Enter');
    expect(box().value).toBe('Create a report on ');
    expect(listbox()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('moves with the arrows, closes on Esc keeping the text, and opens on "/" only first', async () => {
    await render();
    await type('/');
    await press('ArrowDown');
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toBe('/analyzeAnalyze');
    await press('ArrowUp');
    await press('ArrowUp');
    // Up from the first wraps to the last: /image (W4-08b).
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toBe(
      '/imageCreate image',
    );
    await press('Escape');
    expect(listbox()).toBeNull();
    expect(box().value).toBe('/');

    await type('Compare a/b');
    expect(listbox()).toBeNull();
    await type('/zz');
    expect(document.body.textContent).toContain('No shortcuts match');
  });

  it('opens the shortcuts from the / button, the text kept after the starter', async () => {
    await render();
    await type('our pricing page');
    await act(async () => button('Skills and shortcuts')!.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')][1].click(),
    );
    expect(box().value).toBe('Analyze our pricing page');
  });

  it('sends the picked shortcut with its message while the trigger words stay', async () => {
    await render();
    await type('/an');
    await press('Enter');
    await type('Analyze our citations on Perplexity');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Analyze our citations on Perplexity', {
      context: [],
      references: [],
      attachments: [],
      shortcutId: 'analyze',
    });

    // Picked from the / button, the text after the words: the shortcut's too.
    handlers.onSend.mockReset();
    await type('Q3 share of voice');
    await act(async () => button('Skills and shortcuts')!.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')][2].click(),
    );
    expect(box().value).toBe('Create a report on Q3 share of voice');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).toMatchObject({ shortcutId: 'new-report' });
  });

  it('drops the shortcut once its trigger words are rewritten, and keeps it on a refused send', async () => {
    await render();
    await type('/an');
    await press('Enter');
    await type('Why did our citations drop?');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');

    // Typed back, it doesn't come back: the person wrote it.
    handlers.onSend.mockReset();
    await type('Analyze our citations');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');

    // A refused send puts the text back with its shortcut.
    handlers.onSend.mockReset();
    handlers.onSend.mockResolvedValueOnce(false);
    await type('/au');
    await press('Enter');
    await type('Run an audit on our pricing page');
    await press('Enter');
    expect(box().value).toBe('Run an audit on our pricing page');
    await press('Enter');
    expect(handlers.onSend.mock.calls.map((call) => call[1].shortcutId)).toEqual([
      'audit',
      'audit',
    ]);
  });

  it('gives Analysts and Agency partners no shortcuts', async () => {
    await render({}, 'analyst');
    expect(button('Skills and shortcuts')).toBeNull();
    await type('/');
    expect(listbox()).toBeNull();
  });

  // The enabled skills (W2-04, CHAT-13 item 5), as the page passes them.
  const SKILLS = [
    { name: 'faq', title: 'FAQ from fan-outs' },
    { name: 'report', title: 'Weekly report' },
    { name: 'compare', title: 'Comparison page' },
  ];

  it("lists the skills under Skills after the shortcuts, filters both, and puts a skill's /command first", async () => {
    await render({ skills: SKILLS });
    await type('/');
    // Reports is /new-report: /report is the Weekly report skill's.
    expect(options()).toEqual([
      ...ALL_SHORTCUTS,
      '/faqFAQ from fan-outs',
      '/reportWeekly report',
      '/compareComparison page',
    ]);
    expect(document.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Skills');

    await type('/fa');
    expect(options()).toEqual(['/faqFAQ from fan-outs']);
    await press('Enter');
    expect(box().value).toBe('/faq ');
    expect(listbox()).toBeNull();
    expect(handlers.onSend).not.toHaveBeenCalled();
    // A skill's message carries no shortcut.
    await type('/faq Our pricing page');
    await press('Enter');
    expect(handlers.onSend.mock.calls[0][1]).not.toHaveProperty('shortcutId');
  });

  it('reaches the skills with the arrows, keeps the text after one picked from the / button, and says when none match', async () => {
    await render({ skills: SKILLS });
    await type('our pricing page');
    await act(async () => button('Skills and shortcuts')!.click());
    await press('ArrowUp');
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toBe(
      '/compareComparison page',
    );
    await press('Enter');
    expect(box().value).toBe('/compare our pricing page');

    await type('/zz');
    expect(document.body.textContent).toContain('No shortcuts or skills match');
  });

  it('shows no Skills group without skills: the new Chat off', async () => {
    await render();
    await type('/');
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(options()).toHaveLength(ALL_SHORTCUTS.length);
  });

  it('references data on "@": the page’s own first, then the brand’s matches; the pick is a chip that goes with the message', async () => {
    const searchReferences = vi.fn(async () => [
      { type: 'prompt' as const, id: 'p1', label: 'Best AEO tools' },
      { type: 'page' as const, id: 'https://ansvisor.com/pricing', label: 'ansvisor.com/pricing' },
    ]);
    const chart = {
      type: 'chart' as const,
      id: 'visibility-by-platform',
      label: 'Visibility by platform',
      scope: { range: '30d' },
    };
    await render({ references: [chart], searchReferences });
    await type('Explain @');
    expect(listbox()!.getAttribute('aria-label')).toBe('Reference your data');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(searchReferences).toHaveBeenCalledWith('');
    expect(options()).toEqual([
      'Visibility by platformChart',
      'Best AEO toolsPrompt',
      'ansvisor.com/pricingPage',
    ]);
    // No ID anywhere on screen.
    expect(document.body.textContent).not.toContain('visibility-by-platform');
    expect(document.body.textContent).not.toContain('p1');

    await press('Enter');
    expect(box().value).toBe('Explain ');
    const chips = [...container.querySelectorAll('[data-action="composer.removeChip"]')];
    expect(chips.map((c) => c.parentElement!.textContent)).toEqual(['Visibility by platform×']);

    await type('Explain this');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Explain this', {
      context: [],
      references: [chart],
      attachments: [],
    });
    expect(container.querySelector('[data-action="composer.removeChip"]')).toBeNull();
  });

  it('opens @ from its button at the cursor, filters as you type, and takes a reference off with ×', async () => {
    await render({
      references: [
        { type: 'chart', id: 'c1', label: 'Visibility by platform' },
        { type: 'metric', id: 'm1', label: 'Share of voice' },
      ],
    });
    await type('Why');
    await act(async () => button('Reference a chart, metric, page or task')!.click());
    expect(box().value).toBe('Why @');
    await type('Why @share');
    expect(options()).toEqual(['Share of voiceMetric']);
    await press('Enter');
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-action="composer.removeChip"]',
    )!;
    expect(remove.getAttribute('aria-label')).toBe('Remove Share of voice');
    await act(async () => remove.click());
    expect(container.querySelector('[data-action="composer.removeChip"]')).toBeNull();
  });

  it('attaches files and connects a tool from ＋ for an Admin', async () => {
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await render({ uploader: { upload: vi.fn(), remove: vi.fn() } });
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    expect(options()).toEqual([
      'Attach filesUp to 5 files, 10 MB each',
      'Create an imageChat asks which image model to use, then creates it',
      'Connect a toolAdmins connect · others ask an Admin',
    ]);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="plusMenu.attachFiles"]')!.click(),
    );
    expect(pick).toHaveBeenCalledOnce();
    pick.mockRestore();

    await act(async () => button('Attach, read a page or connect a tool')!.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="plusMenu.connectTool"]')!.click(),
    );
    expect(router.push).toHaveBeenCalledWith('/dashboard/settings/integrations');
  });

  it('lets other members ask an Admin to connect, in one click', async () => {
    requestAccess.mockResolvedValue({ ok: true });
    await render({}, 'manager');
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    // No Attach files without the page's upload (W1-13).
    expect(options()).toEqual([
      'Create an imageChat asks which image model to use, then creates it',
      'Ask your Admin to connectAdmins connect · others ask an Admin',
    ]);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="plusMenu.connectTool"]')!.click(),
    );
    expect(requestAccess).toHaveBeenCalledWith({
      asked: 'Connect a tool so Chat can use it',
      ruleKind: 'role',
    });
    expect(toast.success).toHaveBeenCalledWith('Sent to your Admins');
  });

  it('starts the /image shortcut from ＋ Create an image, and sends with its data plan (W4-08b)', async () => {
    await render();
    await type('our GEO post');
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="plusMenu.createImage"]')!.click(),
    );
    // The text typed stays after the shortcut's first words.
    expect(box().value).toBe('Create an image for our GEO post');
    expect(document.querySelector('[data-action="plusMenu.createImage"]')).toBeNull();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Create an image for our GEO post', {
      context: [],
      references: [],
      attachments: [],
      shortcutId: 'image',
    });
  });

  it('lists /image with the shortcuts, filling its first words (W4-08b)', async () => {
    await render();
    await type('/ima');
    expect(options()).toEqual(['/imageCreate image']);
    await press('Enter');
    expect(box().value).toBe('Create an image for ');
  });

  it('offers no Create an image to a role that only reads (W4-08b)', async () => {
    await render({}, 'analyst');
    await act(async () => button('Attach, read a page or connect a tool')!.click());
    expect(document.querySelector('[data-action="plusMenu.createImage"]')).toBeNull();
  });
});

describe('ChatComposer: the image model on the model button (W4-08b, CHAT-15 item 18)', () => {
  const model = () => container.querySelector('[data-action="model.openMenu"]')!.textContent;

  it('reads "Image · {model}" for an image task, and the chat model otherwise', async () => {
    const choice = { model: 'auto', effort: 'normal' } as const;
    await render({ modelChoice: choice, onModelChoice: vi.fn(), imageModel: 'Nano Banana 2 Lite' });
    expect(model()).toBe('Image · Nano Banana 2 Lite ▾');
    await render({ modelChoice: choice, onModelChoice: vi.fn(), imageModel: null });
    expect(model()).toBe('Auto ▾');
  });
});

describe("ChatComposer: a menu's side and height (W2-04)", () => {
  // The page's scrolling area, under a 53px header, in a 1024×768 window (jsdom's size).
  const SCROLLER = { top: 53, bottom: 768 };
  const SKILLS = Array.from({ length: 14 }, (_, i) => ({
    name: `skill-${i}`,
    title: `Skill ${i}`,
  }));
  const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')!;

  /** The composer's box at `box` (`left` and `width` across), and the menu's rows `content` px tall. */
  type Rect = { top: number; bottom: number; left?: number; width?: number };
  function layout(box: Rect, content = 500) {
    container.style.overflowY = 'auto';
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(content);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const isBox = this.getAttribute('data-slot') === 'composer-box';
      const r: Rect = this === container ? SCROLLER : isBox ? box : { top: 0, bottom: 0 };
      const left = r.left ?? 0;
      const width = r.width ?? 0;
      return {
        top: r.top,
        bottom: r.bottom,
        left,
        right: left + width,
        x: left,
        y: r.top,
        width,
        height: r.bottom - r.top,
      } as DOMRect;
    });
  }
  afterEach(() => vi.restoreAllMocks());

  it("opens below when the room above the box (under the header, not the window's top) can't hold it", async () => {
    // Chat Home: the box 210px under the header.
    layout({ top: 263, bottom: 363 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('below');
    // Fixed in the window, 8px under the box.
    expect(listbox().className).toContain('fixed');
    expect(listbox().style.top).toBe('371px');
    expect(listbox().style.bottom).toBe('');
    expect(listbox().style.maxHeight).toBe('300px');
  });

  it('opens above when its rows fit there, as in a chat and the side panel', async () => {
    layout({ top: 600, bottom: 700 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('above');
    // Its bottom 8px over the box's top, so it stays on the box as filtering shortens it.
    expect(listbox().style.bottom).toBe(`${768 - 600 + 8}px`);
    expect(listbox().style.top).toBe('');
    expect(listbox().style.maxHeight).toBe('300px');

    // A short menu fits above Chat Home's box too.
    act(() => root.unmount());
    root = createRoot(container);
    layout({ top: 263, bottom: 363 }, 120);
    await render();
    await type('/');
    expect(listbox().dataset.side).toBe('above');
  });

  it('keeps to the room it has: above when there is less below, as tall as the room less the gap', async () => {
    // 147px above the box, 68px below it.
    layout({ top: 200, bottom: 700 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().dataset.side).toBe('above');
    expect(listbox().style.maxHeight).toBe(`${200 - 53 - 8}px`);
  });

  it('is no wider than a narrow panel’s box, starts at its left edge, and never passes the window’s right edge', async () => {
    // The Content Editor's Chat: a 423px box at the window's right.
    layout({ top: 600, bottom: 700, left: 593, width: 423 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().style.width).toBe('423px');
    expect(listbox().style.left).toBe('593px');

    // The Chat page: a 720px box, the menu at its own 520px.
    act(() => root.unmount());
    root = createRoot(container);
    layout({ top: 600, bottom: 700, left: 152, width: 720 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().style.width).toBe('520px');
    expect(listbox().style.left).toBe('152px');

    // A box running past the window: the menu moves left to stay 8px inside it.
    act(() => root.unmount());
    root = createRoot(container);
    layout({ top: 600, bottom: 700, left: 800, width: 400 });
    await render({ skills: SKILLS });
    await type('/');
    expect(listbox().style.width).toBe('400px');
    expect(listbox().style.left).toBe(`${1024 - 8 - 400}px`);
  });

  it('picks its side again when the window changes size, and keeps the active row in view by scrolling only itself', async () => {
    const box = { top: 263, bottom: 363 };
    layout(box);
    // Each row 34px, under a 40px title; the menu shows 300px of them.
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      const rows = [...document.querySelectorAll('[role="option"]')];
      return rows.includes(this) ? 40 + rows.indexOf(this) * 34 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(34);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'listbox' ? 300 : 0;
    });
    const scrolled = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrolled,
      configurable: true,
    });
    try {
      await render({ skills: SKILLS });
      await type('/');
      expect(listbox().dataset.side).toBe('below');
      box.top = 600;
      box.bottom = 700;
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(listbox().dataset.side).toBe('above');

      await press('ArrowUp');
      const selected = document.querySelector('[aria-selected="true"]')!;
      expect(selected.textContent).toBe('/skill-13Skill 13');
      // The 22nd row's bottom at 40 + 22 × 34: the menu scrolls to it, nothing else does.
      expect(listbox().scrollTop).toBe(40 + 22 * 34 - 300);
      expect(scrolled).not.toHaveBeenCalled();
      await press('ArrowDown');
      expect(listbox().scrollTop).toBe(40);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('ChatComposer: "/" opens without a jump (owner’s report, 2026-11-14)', () => {
  // The composer's own blocks and the box's, as nodes, to see that none is added, dropped or swapped.
  const blocks = () => {
    const composer = container.firstElementChild!;
    const shell = container.querySelector('[data-slot="composer-box"]')!;
    return {
      composer: [...composer.children],
      box: [...shell.children],
      boxClass: shell.className,
      line: underLine(),
    };
  };

  it('draws the / menu in the page’s body, so the box, its line and what holds them stay as they were', async () => {
    await render({ ghost: 'Show which pages Gemini cites most', variant: 'panel' });
    const before = blocks();
    expect(under()).toBe('Tab to accept · / skills · @ data');

    await type('/');
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Skills and shortcuts');
    // A popover: a child of the body, outside the composer, fixed in the window.
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.className).toContain('fixed');
    // Nothing in the composer moved: the same nodes in the same places.
    const after = blocks();
    expect(after.composer).toEqual(before.composer);
    expect(after.box).toEqual(before.box);
    expect(after.boxClass).toBe(before.boxClass);
    expect(after.line).toBe(before.line);
    // The ghost's hint goes from the line, the line stays.
    expect(under()).toBe('');
    expect(underLine().className).toContain('h-7');

    // The same from the / button, and for @ and ＋.
    await press('Escape');
    await type('');
    for (const label of [
      'Skills and shortcuts',
      'Reference a chart, metric, page or task',
      'Attach, read a page or connect a tool',
    ]) {
      await act(async () => button(label)!.click());
      expect(document.querySelector('[role="listbox"]')!.parentElement).toBe(document.body);
      expect(blocks().box).toEqual(before.box);
      expect(blocks().line).toBe(before.line);
      await press('Escape');
    }
  });

  it('keeps a click in the menu, and closes it on a click outside the composer', async () => {
    await render();
    await type('/');
    const option = document.querySelector<HTMLElement>('[data-action="slashMenu.pickShortcut"]')!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => option.click());
    expect(box().value).toBe('Help me get started. What should I set up first? ');

    await type('/');
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('ChatComposer: attached files (W1-13)', () => {
  const MB = 1024 * 1024;
  const file = (name: string, type: string, size: number) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  async function pick(...files: File[]) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
  const fileChips = () =>
    [...container.querySelectorAll<HTMLElement>('[data-slot="composer-file"]')].map((c) => [
      c.dataset.status,
      c.textContent,
    ]);
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null;

  it('shows each file as a chip while it goes up, and sends the ready ones with the message', async () => {
    let finish: (value: { ok: true; id: string }) => void = () => {};
    const upload = vi.fn(
      () => new Promise<{ ok: true; id: string }>((resolve) => (finish = resolve)),
    );
    await render({ uploader: { upload, remove: vi.fn() } });
    await type('Read this brief');
    await pick(file('brief.pdf', 'application/pdf', 2 * MB));
    expect(fileChips()).toEqual([['uploading', 'PDFbrief.pdfUploading…×']]);
    // Send waits for the file.
    expect(button('Send')!.disabled).toBe(true);
    expect(under()).toContain('Send waits for your files');

    await act(async () => finish({ ok: true, id: 'up-1' }));
    expect(fileChips()).toEqual([['ready', 'PDFbrief.pdf×']]);
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('Read this brief', {
      context: [],
      references: [],
      attachments: ['up-1'],
      // As the question's bubble shows them until the chat is read again.
      files: [{ id: 'up-1', name: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 2 * MB }],
    });
    expect(fileChips()).toEqual([]);
  });

  it('sends an image with no text', async () => {
    const upload = vi.fn(async () => ({ ok: true as const, id: 'up-img' }));
    await render({ uploader: { upload, remove: vi.fn() } });
    expect(button('Send')!.disabled).toBe(true);
    await pick(file('chart.png', 'image/png', MB));
    expect(button('Send')!.disabled).toBe(false);
    await act(async () => button('Send')!.click());
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('', {
      context: [],
      references: [],
      attachments: ['up-img'],
      files: [{ id: 'up-img', name: 'chart.png', mimeType: 'image/png', sizeBytes: MB }],
    });
  });

  it('refuses Send while a file didn’t upload, and says which', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, id: 'up-1' })
      .mockResolvedValueOnce({ ok: false, failure: 'failed' });
    await render({ uploader: { upload, remove: vi.fn() } });
    await type('Compare these');
    await pick(file('a.png', 'image/png', MB), file('b.csv', 'text/csv', 100));
    expect(fileChips()).toEqual([
      ['ready', 'PNGa.png×'],
      ['failed', 'CSVb.csv×'],
    ]);
    expect(alert()).toBe("b.csv didn't upload. Remove it or try again.Retry");
    expect(button('Send')!.disabled).toBe(true);
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    // Taken off with ×, the message goes with the file that is up.
    await act(async () =>
      container
        .querySelectorAll<HTMLButtonElement>('[data-action="composer.removeFile"]')[1]
        .click(),
    );
    expect(alert()).toBeNull();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledWith(
      'Compare these',
      expect.objectContaining({ attachments: ['up-1'] }),
    );
  });

  it('counts the files that didn’t upload', async () => {
    const upload = vi.fn(async () => ({ ok: false as const, failure: 'failed' }));
    await render({ uploader: { upload, remove: vi.fn() } });
    await pick(file('a.csv', 'text/csv', 100), file('b.csv', 'text/csv', 100));
    expect(alert()).toBe("2 files didn't upload. Remove them or try again.Retry");
  });

  it('says why a file can’t go: its type, over 10 MB, or a sixth', async () => {
    const upload = vi.fn(async () => ({ ok: true as const, id: 'up' }));
    await render({ uploader: { upload, remove: vi.fn() } });
    await pick(file('setup.exe', 'application/x-msdownload', MB));
    expect(alert()).toBe("This file type isn't supported.");
    await pick(file('big.pdf', 'application/pdf', 12 * MB));
    expect(alert()).toBe('Files must be 10 MB or smaller.');
    await pick(...['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`${n}.csv`, 'text/csv', 100)));
    expect(alert()).toBe('You can attach up to 5 files.');
    expect(fileChips()).toHaveLength(5);
    expect(upload).toHaveBeenCalledTimes(5);
  });

  it('offers Retry for a file that failed, and takes a file away with ×', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, failure: 'failed' })
      .mockResolvedValueOnce({ ok: true, id: 'up-2' });
    const remove = vi.fn();
    await render({ uploader: { upload, remove } });
    await pick(file('data.csv', 'text/csv', 100));
    expect(alert()).toBe("data.csv didn't upload. Remove it or try again.Retry");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="composer.retryUpload"]')!.click(),
    );
    expect(fileChips()).toEqual([['ready', 'CSVdata.csv×']]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="composer.removeFile"]')!.click(),
    );
    expect(fileChips()).toEqual([]);
    expect(remove).toHaveBeenCalledWith('up-2');
  });

  it('attaches nothing without the page’s uploader', async () => {
    await render();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('ChatComposer: own keys (W4-06)', () => {
  const KEY = `sk-proj-${'Xy9_'.repeat(12)}`;
  const action = (name: string) => container.querySelector<HTMLElement>(`[data-action="${name}"]`);

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access: { state: 'plan' }, providers: [] }))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('answers "use my OpenAI key" with the Add API key card, sending nothing to Chat', async () => {
    await render({ keyForm: true });
    await type('Please use my OpenAI key for Chat');
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(container.querySelector('[data-slot="add-key-card"]')).not.toBeNull();
    // The message stays: a misread loses nothing, and a second send sends it.
    expect(box().value).toBe('Please use my OpenAI key for Chat');
    await act(async () => action('addKey.close')!.click());
    expect(container.querySelector('[data-slot="add-key-card"]')).toBeNull();
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledWith(
      'Please use my OpenAI key for Chat',
      expect.anything(),
    );
  });

  it('sends a question that only says "key", as "our key competitors"', async () => {
    await render({ keyForm: true });
    await type('Add our key competitors to the brief');
    await press('Enter');
    expect(container.querySelector('[data-slot="add-key-card"]')).toBeNull();
    expect(handlers.onSend).toHaveBeenCalledWith(
      'Add our key competitors to the brief',
      expect.anything(),
    );
  });

  it('opens the card with a pasted key on Save securely, for an Admin, the key out of the box', async () => {
    await render({ keyForm: true });
    await type(`use this ${KEY}`);
    await act(async () => action('composer.saveKey')!.click());
    expect(box().value).toBe('use this');
    expect((action('addKey.key') as HTMLInputElement).value).toBe(KEY);
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('shows no Save securely to a Manager, and sends a key question as ever without the forms', async () => {
    await render({ keyForm: true }, 'manager');
    await type(`key ${KEY}`);
    expect(action('composer.saveKey')).toBeNull();

    await render();
    await type('use my OpenAI key');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledWith('use my OpenAI key', expect.anything());
  });
});
