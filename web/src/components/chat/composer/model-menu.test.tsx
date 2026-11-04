import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatModelChoice } from '@/lib/chat/models';

/**
 * The composer's model menu (W4-02, CHAT-16 §A–C): Auto and the offered
 * models with multipliers, the effort, the own-key row, the month's AI usage
 * and the plan, no dollar; Auto only in the free trial.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const usage = vi.hoisted(() => ({
  value: {
    plan: 'growth',
    planName: 'Growth',
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    unlimited: false,
    percentUsed: 23.4,
    features: [],
  } as Record<string, unknown> | null,
}));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: usage.value }),
}));

const { ModelMenu } = await import('./model-menu');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onChange = vi.fn();
const onClose = vi.fn();

const MENU = {
  auto: { id: 'auto', multiplier: '1x', tone: 'normal' },
  models: [
    {
      id: 'anthropic/claude-haiku-5.5',
      name: 'Claude Haiku 5.5',
      multiplier: '0.1x',
      tone: 'low',
      variesByHour: false,
      yourKey: false,
    },
    {
      id: 'anthropic/claude-sonnet-5.5',
      name: 'Claude Sonnet 5.5',
      multiplier: '2.3x',
      tone: 'normal',
      variesByHour: false,
      yourKey: false,
    },
    {
      id: 'anthropic/claude-opus-5.5',
      name: 'Claude Opus 5.5',
      multiplier: '4.7x',
      tone: 'high',
      variesByHour: true,
      yourKey: false,
    },
  ],
  selected: null,
  catalogCount: 312,
  updatedAt: new Date().toISOString(),
};
const ACCESS = {
  choiceOpen: true,
  planName: 'Growth',
  trial: false,
  ownKeys: { state: 'locked' },
};

function answer(menu: unknown = MENU, access: unknown = ACCESS) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, menu, access })));
}

async function render(choice: ChatModelChoice = { model: 'auto', effort: 'normal' }) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ModelMenu choice={choice} onChange={onChange} onClose={onClose} />
      </NextIntlClientProvider>,
    );
  });
  // The menu's read settles.
  await act(async () => {});
}

const radios = (group: string) => [
  ...container.querySelectorAll<HTMLButtonElement>(
    `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
  ),
];
const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onChange.mockReset();
  onClose.mockReset();
  usage.value = { ...(usage.value ?? {}), percentUsed: 23.4, unlimited: false };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ModelMenu', () => {
  it('lists Auto first, ticked, then the models with their multipliers and tones, and no dollar', async () => {
    answer();
    await render();
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/models');
    const models = radios('Models');
    expect(models.map((b) => b.getAttribute('data-model'))).toEqual([
      'auto',
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-opus-5.5',
    ]);
    expect(models[0].getAttribute('aria-checked')).toBe('true');
    expect(models[0].textContent).toContain('Haiku 5.5 reads, Sonnet 5.5 writes');
    expect(models[0].textContent).toContain('Default');
    expect(models[1].textContent).toContain('Haiku 5.5');
    expect(models[1].querySelector('[data-tone="low"]')?.textContent).toBe('0.1x');
    expect(models[3].querySelector('[data-tone="high"]')?.className).toContain('dark:');
    expect(models[3].textContent).toContain('Price varies by hour');
    expect(text()).toContain('Prices from OpenRouter, updated today. 1x = Auto.');
    expect(text()).not.toMatch(/\$|per 1M/);
  });

  it('puts the pick on the chat, keeping the effort, and closes', async () => {
    answer();
    await render({ model: 'auto', effort: 'high' });
    await act(async () => radios('Models')[2].click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      model: 'anthropic/claude-sonnet-5.5',
      effort: 'high',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sets the effort, with what High and Max cost', async () => {
    answer();
    await render({ model: 'anthropic/claude-opus-5.5', effort: 'normal' });
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/models?selected=anthropic%2Fclaude-opus-5.5');
    const efforts = radios('Effort');
    expect(efforts.map((b) => b.textContent)).toEqual(['Normal', 'High', 'Max']);
    expect(text()).toContain('High and Max use your limit faster');
    await act(async () => efforts[2].click());
    expect(onChange).toHaveBeenCalledWith({ model: 'anthropic/claude-opus-5.5', effort: 'max' });
  });

  it('runs the free trial on Auto at Normal only', async () => {
    answer(MENU, { ...ACCESS, choiceOpen: false, trial: true });
    await render();
    const models = radios('Models');
    expect(models[0].disabled).toBe(false);
    expect(models.slice(1).every((b) => b.disabled)).toBe(true);
    const efforts = radios('Effort');
    expect(efforts.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(text()).toContain(
      'In the free trial, Chat runs on Auto. Start your plan to pick a model.',
    );
    expect(text()).toContain('Growth · free trial');
  });

  it('says own keys come with Enterprise, or opens AI Providers where the plan includes them', async () => {
    answer();
    await render();
    expect(text()).toContain("Own API keys come with Enterprise · you're on Growth");
    expect(container.querySelector('[data-action="model.ownKeys"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    answer(MENU, { ...ACCESS, planName: 'Enterprise', ownKeys: { state: 'plan' } });
    await render();
    const link = container.querySelector('[data-action="model.ownKeys"]');
    expect(link?.textContent).toBe('Included in your plan');
    expect(link?.getAttribute('href')).toBe('/dashboard/settings/ai-providers');

    act(() => root.unmount());
    root = createRoot(container);
    answer(MENU, { ...ACCESS, ownKeys: { state: 'kept', until: '2026-12-03T00:00:00.000Z' } });
    await render();
    expect(container.querySelector('[data-action="model.ownKeys"]')?.textContent).toBe(
      'Works until Dec 3',
    );
  });

  it('shows the month’s AI usage as a percent with its reset, and the plan with See plans', async () => {
    answer();
    await render();
    expect(text()).toContain('Monthly AI usage');
    expect(text()).toContain('23.4% · Resets Dec 1');
    expect(container.querySelector('[data-action="model.seePlans"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/billing',
    );
  });

  it('says when the chat’s model was dropped from the catalog, and shows Auto ticked', async () => {
    answer({ ...MENU, selected: { id: 'anthropic/claude-opus-5.5', removed: true } });
    await render({ model: 'anthropic/claude-opus-5.5', effort: 'normal' });
    expect(text()).toContain('no longer available, so Chat runs on Auto');
    expect(radios('Models')[0].getAttribute('aria-checked')).toBe('true');
  });

  it('closes on Esc, and says so when the models can’t be read', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't read the models",
    );
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
