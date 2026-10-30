import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { ChatMode } from '@/lib/chat/precedence';
import { composerKeyAction } from './composer-keys';

/**
 * Chat's composer (W1-10, CHAT-02): send, Stop and steering, the run mode
 * with Full auto's plan lock, and the read-only composer of Analysts and
 * Agency partners.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));

const { ChatComposer } = await import('./chat-composer');

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
const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const under = () => container.lastElementChild!.lastElementChild!.textContent;

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
    expect(handlers.onSteer).toHaveBeenCalledExactlyOnceWith('only blog pages', { context: [] });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('waits for the run on Enter when the page doesn’t steer', async () => {
    await render({ running: true, onStop: handlers.onStop });
    await type('only blog pages');
    await press('Enter');
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('only blog pages');
  });

  it('switches the run mode, saying what it does, and locks Full auto below Growth', async () => {
    await render({ fullAutoOpen: false });
    expect(radios().map((r) => r.textContent)).toEqual([
      'Ask me first',
      'Auto, ask before changes',
      'Full autoNeeds Growth',
    ]);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');

    const fullAuto = radios()[2];
    expect(fullAuto.getAttribute('aria-disabled')).toBe('true');
    await act(async () => fullAuto.click());
    expect(handlers.onModeChange).not.toHaveBeenCalled();

    await act(async () => radios()[0].click());
    expect(handlers.onModeChange).toHaveBeenCalledExactlyOnceWith('ask_first');
    expect(toast).toHaveBeenCalledWith('Ask me first: the agent asks before every step.');
  });

  it('opens Full auto on Growth, with its toast', async () => {
    await render({ fullAutoOpen: true });
    await act(async () => radios()[2].click());
    expect(handlers.onModeChange).toHaveBeenCalledWith('full_auto');
    expect(toast).toHaveBeenCalledWith(
      'Full auto: the agent makes changes without asking. Nothing is published or sent without your click. Every change is in the Activity log.',
    );
  });

  it('reads only for an Analyst or an Agency partner: no mode, a link to what they can do', async () => {
    for (const [role, name] of [
      ['analyst', 'Analyst'],
      ['agency_partner', 'Agency partner'],
    ] as const) {
      await render({}, role);
      expect(radios()).toHaveLength(0);
      const link = container.querySelector('a')!;
      expect(link.textContent).toBe(`Read-only · ${name}`);
      expect(link.getAttribute('href')).toBe('/dashboard/chat/capabilities');
      expect(under()).toContain('@ data · read-only');
    }
    // A manager changes things: the mode is there.
    await render({}, 'manager');
    expect(radios()).toHaveLength(3);
  });

  it('starts Chat home’s box at two rows, the others at one', async () => {
    await render({ variant: 'home' });
    expect(box().rows).toBe(2);
    await render({ variant: 'panel' });
    expect(box().rows).toBe(1);
  });

  it('shows the model on Auto in the line under the box', async () => {
    await render();
    expect(under()).toContain('Auto · Haiku reads, Sonnet writes');
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
    expect(long.parentElement!.getAttribute('title')).toBe(chips[2].label);
    expect(long.getAttribute('aria-label')).toBe(`Remove ${chips[2].label}`);
    await act(async () => (long as HTMLButtonElement).click());
    expect(onRemoveChip).toHaveBeenCalledExactlyOnceWith('prompt');

    await type('What changed?');
    await press('Enter');
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith('What changed?', { context: chips });
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
    expect(handlers.onSend).toHaveBeenCalledExactlyOnceWith(ghost, { context: [] });
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
