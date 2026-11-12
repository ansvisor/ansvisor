import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SwapOptions } from '@/lib/actions/prompt-swap';
import type { PauseCandidate } from '@/lib/prompt-swap';

/**
 * The Prompt-limit dialog (mockup Prompt-limit, SIMPLE_NAV, Simplify PR
 * 16): "Saved, but not tracked yet" with the plan's numbers, the prompts
 * that could be paused in the order the server ranks them, a pick that
 * frees enough spots for a prompt in several locations, the swap and what
 * it says when tracking fails, and the plan's way out.
 */

const swap = vi.hoisted(() => ({ getSwapOptions: vi.fn(), swapPrompts: vi.fn() }));
vi.mock('@/lib/actions/prompt-swap', () => swap);
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);

const { PromptLimitDialog } = await import('./_prompt-limit-dialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const candidate = (id: string, over: Partial<PauseCandidate> = {}): PauseCandidate => ({
  id,
  text: `Prompt ${id}`,
  brandId: 'b1',
  brandName: 'Brewline',
  current: true,
  locations: 1,
  demand: 'low',
  mentions: 0,
  answers: 30,
  ...over,
});

const options = (over: Partial<SwapOptions> = {}): SwapOptions => ({
  prompt: {
    id: 'w',
    text: 'Best cold brew concentrate for home',
    brandId: 'b1',
    locations: 1,
    waiting: true,
  },
  plan: { id: 'starter', name: 'Starter', max: 50, used: 50 },
  candidates: [
    candidate('ethical', { text: 'Where to buy ethically sourced coffee beans online' }),
    candidate('grinder', { text: 'How to choose a grinder for pour-over coffee', mentions: 1 }),
    candidate('roast', {
      text: 'Light vs dark roast: which has more caffeine?',
      demand: 'medium',
      mentions: 2,
    }),
    candidate('tea', { current: false, brandName: 'Brewline Tea', locations: 2, demand: null }),
  ],
  growthPrompts: 200,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onDone = vi.fn();

async function open(promptId: string | null = 'w') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PromptLimitDialog promptId={promptId} onClose={onClose} onDone={onDone} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const rows = () => [...dialog().querySelectorAll<HTMLElement>('[data-candidate]')];
const input = (id: string) =>
  dialog().querySelector<HTMLInputElement>(`[data-candidate="${id}"] input`)!;

beforeEach(() => {
  vi.clearAllMocks();
  swap.getSwapOptions.mockResolvedValue(options());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PromptLimitDialog', () => {
  it('says the prompt is saved but not tracked, with the plan’s numbers', async () => {
    await open();
    expect(swap.getSwapOptions).toHaveBeenCalledWith('w');
    expect(dialog().textContent).toContain('Prompt limit reached · 50 of 50');
    expect(dialog().textContent).toContain('Saved, but not tracked yet');
    expect(dialog().textContent).toContain(
      '“Best cold brew concentrate for home” is in Tracked Prompts as Waiting for a spot. Your Starter plan tracks up to 50 prompt locations, and all 50 are in use. To track it, pause a prompt you need less, or move to a bigger plan.',
    );
    expect(analytics.track).toHaveBeenCalledWith('upgrade_wall_shown', {
      feature: 'max_prompts',
      reason: 'plan_limit',
      source: 'prompts',
    });
  });

  it('lists the prompts to pause least useful first, this brand first, and picks the first', async () => {
    await open();
    expect(rows().map((row) => row.querySelector('.font-medium')?.textContent)).toEqual([
      'Where to buy ethically sourced coffee beans online',
      'How to choose a grinder for pour-over coffee',
      'Light vs dark roast: which has more caffeine?',
      'Prompt tea',
    ]);
    expect(rows().map((row) => row.querySelector('.text-xs')?.textContent)).toEqual([
      'Low demand · not named in the last 30 days',
      'Low demand · named once in 30 days',
      'Medium demand · named 2 times in 30 days',
      'Demand not measured · not named in the last 30 days · 2 locations · Brewline Tea',
    ]);
    expect(input('ethical').type).toBe('radio');
    expect(input('ethical').checked).toBe(true);
    await act(async () => input('grinder').click());
    expect(input('grinder').checked).toBe(true);
    expect(input('ethical').checked).toBe(false);
  });

  it('pauses the pick and tracks the prompt in one go, then reads the page again', async () => {
    swap.swapPrompts.mockResolvedValue({ ok: true, prompt: { id: 'w' }, paused: 1 });
    await open();
    await act(async () => button('Pause it and track this one')!.click());
    expect(swap.swapPrompts).toHaveBeenCalledWith('w', ['ethical']);
    expect(analytics.track).toHaveBeenCalledWith('prompt_swap', { result: 'swapped' });
    expect(toast.success).toHaveBeenCalledWith(
      'Paused 1 prompt. Tracking “Best cold brew concentrate for home” now',
    );
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('needs a spot for each location: ticks enough, and waits until the picks free them', async () => {
    swap.getSwapOptions.mockResolvedValue(
      options({
        prompt: { ...options().prompt, locations: 3 },
        plan: { id: 'starter', name: 'Starter', max: 50, used: 49 },
      }),
    );
    swap.swapPrompts.mockResolvedValue({ ok: true, prompt: { id: 'w' }, paused: 2 });
    await open();
    expect(dialog().textContent).toContain('and 49 are in use.');
    expect(dialog().textContent).toContain("It's tracked in 3 locations, so it needs 3 spots.");
    expect(dialog().textContent).toContain('pick enough to free 2 spots');
    expect(input('ethical').type).toBe('checkbox');
    expect(rows().filter((row) => row.querySelector('input')!.checked)).toHaveLength(2);

    await act(async () => input('grinder').click());
    expect(button('Pause it and track this one')!.disabled).toBe(true);
    await act(async () => input('tea').click());
    expect(button('Pause 2 and track this one')!.disabled).toBe(false);
    await act(async () => button('Pause 2 and track this one')!.click());
    expect(swap.swapPrompts).toHaveBeenCalledWith('w', ['ethical', 'tea']);
  });

  it('says the picks are tracked again when tracking it failed, and reads what is free anew', async () => {
    swap.swapPrompts.mockResolvedValue({
      ok: false,
      code: 'failed',
      error: 'boom',
      restored: true,
    });
    await open();
    await act(async () => button('Pause it and track this one')!.click());
    expect(toast.error).toHaveBeenCalledWith("Couldn't track it", {
      description: 'The prompts you picked are tracked again.',
    });
    expect(analytics.track).toHaveBeenCalledWith('prompt_swap', { result: 'failed' });
    expect(onDone).not.toHaveBeenCalled();
    expect(swap.getSwapOptions).toHaveBeenCalledTimes(2);
  });

  it('offers Starter Growth in billing, and anyone else Contact us, beside Keep it waiting', async () => {
    await open();
    const growth = [...dialog().querySelectorAll('a')].find((a) =>
      a.textContent?.includes('See Growth'),
    )!;
    expect(growth.textContent).toBe('See Growth: 200 prompts');
    expect(growth.getAttribute('href')).toBe('/dashboard/settings?tab=billing');
    await act(async () => growth.click());
    expect(analytics.track).toHaveBeenCalledWith('prompt_limit_see_growth', { source: 'dialog' });
    await act(async () => button('Keep it waiting')!.click());
    expect(onClose).toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    swap.getSwapOptions.mockResolvedValue(
      options({ plan: { id: 'growth', name: 'Growth', max: 200, used: 200 } }),
    );
    await open();
    expect(dialog().textContent).toContain('or contact us to raise your limit.');
    expect(dialog().textContent).not.toContain('See Growth');
    expect(dialog().querySelector('a')?.textContent).toBe('Contact us');
  });

  it('just tracks it when the plan has room, as a waiting prompt never starts by itself', async () => {
    swap.getSwapOptions.mockResolvedValue(
      options({ plan: { id: 'starter', name: 'Starter', max: 50, used: 48 } }),
    );
    swap.swapPrompts.mockResolvedValue({ ok: true, prompt: { id: 'w' }, paused: 0 });
    await open();
    expect(dialog().textContent).toContain("There's a spot for it now");
    expect(rows()).toHaveLength(0);
    await act(async () => button('Track it')!.click());
    expect(swap.swapPrompts).toHaveBeenCalledWith('w', []);
    expect(analytics.track).toHaveBeenCalledWith('prompt_swap', { result: 'tracked' });
  });

  it('asks about a paused prompt that doesn’t fit back the same way', async () => {
    swap.getSwapOptions.mockResolvedValue(
      options({ prompt: { ...options().prompt, waiting: false } }),
    );
    await open();
    expect(dialog().textContent).toContain('No spot free to resume it');
    expect(dialog().textContent).toContain('“Best cold brew concentrate for home” is paused.');
    expect(button('Keep it paused')).toBeDefined();
  });

  it('offers to read again when the prompts can’t be read, and stays shut without a prompt', async () => {
    swap.getSwapOptions.mockResolvedValue({ error: 'nope' });
    await open();
    expect(dialog().textContent).toContain("Couldn't read your prompts.");
    await act(async () => button('Try again')!.click());
    expect(swap.getSwapOptions).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    root = createRoot(container);
    await open(null);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
