import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { Prompt } from '@/types';

const actions = vi.hoisted(() => ({
  getLocationQuota: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
// The engines' countries (PROMPT-015e): none read, so the picker's own list.
vi.mock('@/lib/actions/tracking-countries', () => ({ getTrackingCountries: async () => [] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AddLocationsDialog } = await import('./_add-locations-dialog');

/** Track in more locations (PROMPT-015c). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();

const prompt = (id: string, regions: string[], category = 'Delivery'): Prompt =>
  ({ id, text: `prompt ${id}`, regions, category, isActive: true }) as unknown as Prompt;
const prompts = [prompt('p1', ['US']), prompt('p2', ['US']), prompt('p3', ['US'], 'Buying')];

async function render(preset: { promptId?: string; locations?: string[] } | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AddLocationsDialog
          open
          onOpenChange={() => {}}
          brandId={BRAND}
          prompts={prompts}
          selectedIds={new Set()}
          preset={preset}
          onDone={onDone}
        />
      </NextIntlClientProvider>,
    );
  });
  return document.body.textContent ?? '';
}

const submit = () =>
  [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Track in'),
  ) as HTMLButtonElement;
const scope = (label: string) =>
  [...document.body.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))!
    .querySelector('input') as HTMLInputElement;

beforeEach(() => {
  actions.getLocationQuota.mockReset().mockResolvedValue({
    maxPrompts: 200,
    used: 152,
    planId: 'growth',
    planName: 'Growth',
  });
  actions.bulkUpdatePromptLocations
    .mockReset()
    .mockResolvedValue({ updated: 1, unchanged: 0, blocked: 0, delta: 1 });
  toast.success.mockReset();
  onDone.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AddLocationsDialog', () => {
  it("opens on a cell's prompt and location, prices it, and tracks it there", async () => {
    const text = await render({ promptId: 'p2', locations: ['TR'] });
    expect(text).toContain('Track in more locations');
    expect(text).toContain('Türkiye');
    expect(text).toContain('152 → 153 of 200 tracked locations');
    expect(scope('prompt p2').checked).toBe(true);
    await act(async () => submit().click());
    expect(actions.bulkUpdatePromptLocations).toHaveBeenCalledWith(['p2'], 'add', ['TR']);
    expect(toast.success).toHaveBeenCalledWith('1 prompt is now tracked in the new locations.');
    expect(onDone).toHaveBeenCalled();
  });

  it("adds to no prompt when the cell's prompt is no longer shown, rather than to all", async () => {
    const text = await render({ promptId: 'gone', locations: ['TR'] });
    expect(scope('All 3 prompts shown').checked).toBe(false);
    expect(text).toContain('152 → 152 of 200 tracked locations');
    expect(text).toContain('Choose the prompts to add these locations to.');
    expect(submit().disabled).toBe(true);
    await act(async () => scope('All 3 prompts shown').click());
    expect(document.body.textContent).toContain('152 → 155 of 200 tracked locations');
    expect(submit().disabled).toBe(false);
  });

  it('prices a topic and every prompt shown', async () => {
    await render({ locations: ['TR', 'DE'] });
    expect(scope('All 3 prompts shown').checked).toBe(true);
    expect(document.body.textContent).toContain('152 → 158 of 200 tracked locations');
    // The first topic, Buying, has one prompt; Delivery has two.
    await act(async () => scope('Topic').click());
    expect(document.body.textContent).toContain('152 → 154 of 200 tracked locations');
    const topic = document.body.querySelector('select[aria-label="Topic"]') as HTMLSelectElement;
    await act(async () => {
      topic.value = 'Delivery';
      topic.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('152 → 156 of 200 tracked locations');
  });

  it('stops a choice past the limit in place, with the numbers and the plan’s way out', async () => {
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 200,
      used: 199,
      planId: 'growth',
      planName: 'Growth',
    });
    const text = await render({ locations: ['TR'] });
    expect(text).toContain('199 → 202 of 200 tracked locations');
    expect(text).toContain('This needs 3 more tracked locations; 1 is left on your Growth plan.');
    expect(text).toContain('Or contact us for a custom plan.');
    expect(submit().disabled).toBe(true);
    expect(document.body.querySelector('a[href*="billing"]')).toBeNull();
  });

  it('offers Starter an upgrade', async () => {
    actions.getLocationQuota.mockResolvedValue({
      maxPrompts: 50,
      used: 50,
      planId: 'starter',
      planName: 'Starter',
    });
    const text = await render({ locations: ['TR'] });
    expect(text).toContain('none are left on your Starter plan');
    expect(text).toContain('Or upgrade your plan, or contact us for a custom plan.');
    expect(document.body.querySelector('a[href="/dashboard/settings?tab=billing"]')).not.toBeNull();
  });

  it('turns a city off for prompts no engine of which answers from one (PROMPT-015d)', async () => {
    let text = await render({ locations: ['TR~ISTANBUL'] });
    expect(text).toContain('İstanbul');
    expect(text).toContain('None of these prompts runs an engine that answers from a city');
    expect(submit().disabled).toBe(true);
    // One prompt asks Google AI Mode: the city can be added, with a note for the rest.
    prompts[0] = { ...prompts[0], platforms: ['google-aimode'] } as Prompt;
    act(() => root.unmount());
    root = createRoot(container);
    text = await render({ locations: ['TR~ISTANBUL'] });
    expect(text).toContain("2 of these prompts don't run an engine that answers from a city");
    expect(submit().disabled).toBe(false);
    prompts[0] = prompt('p1', ['US']);
  });

  it("says what the server refused, and changes nothing it didn't save", async () => {
    actions.bulkUpdatePromptLocations.mockResolvedValue({
      error: 'Your Growth plan allows up to 200 active prompt locations',
      code: 'plan_limit',
    });
    await render({ promptId: 'p1', locations: ['TR'] });
    await act(async () => submit().click());
    expect(document.body.textContent).toContain('Your Growth plan allows up to 200');
    expect(onDone).not.toHaveBeenCalled();
  });
});
