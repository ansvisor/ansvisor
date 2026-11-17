import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { Brand, Topic } from '@/types';

/**
 * Generate by topic on Prompt Suggestions (moved from the brand's Manage
 * prompts page): the brand's topics, every one picked to start; the same
 * generation call as that page's AI Generate, 5 prompts a topic; the
 * prompts listed by topic, ticked and editable; Add selected saves the
 * ticked ones under their topic, with the plan's engines and the brand's
 * location; Regenerate and Dismiss. For admins and managers only.
 */

const topicActions = vi.hoisted(() => ({ getTopics: vi.fn() }));
vi.mock('@/lib/actions/topic', () => topicActions);
const promptActions = vi.hoisted(() => ({ importPrompts: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => promptActions);
const setup = vi.hoisted(() => {
  class SetupDailyLimitError extends Error {}
  return { generatePromptsFromTopics: vi.fn(), SetupDailyLimitError };
});
vi.mock('@/lib/ai-brand-setup', () => setup);
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ planId: 'starter', allowedModelIds: [] }),
}));
const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));
const brand: Brand = {
  id: 'b1',
  organizationId: 'o1',
  name: 'Acme',
  slug: 'acme',
  industry: 'Coffee',
  description: 'Coffee subscriptions',
  region: 'GB',
  language: 'en',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [{ id: 'd1', brandId: 'b1', domain: 'acme.com', isPrimary: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (select: (state: unknown) => unknown) =>
    select({ activeBrandId: 'b1', brands: [brand] }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const { GenerateByTopic } = await import('./_topic-prompts');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const topic = (id: string, name: string): Topic => ({
  id,
  brandId: 'b1',
  name,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const TOPICS = [topic('t1', 'Coffee'), topic('t2', 'Tea'), topic('t3', 'Mugs')];

/** The API's answer: 5 prompts for each topic asked, in the order asked. */
const written =
  (prefix = 'best') =>
  async (_brand: unknown, topics: string[]) => ({
    topicPrompts: topics.map((name) => ({
      topic: name,
      prompts: Array.from({ length: 5 }, (_, i) => `${prefix} ${name.toLowerCase()} idea ${i + 1}`),
    })),
  });

let container: HTMLDivElement;
let root: Root;
let isLocked = false;
const openUpgrade = vi.fn();
const onAdded = vi.fn();
const onNoTopics = vi.fn();

/** The card's opener, as the Suggestions card has it. */
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open picker
      </button>
      <GenerateByTopic
        brandId="b1"
        open={open}
        onOpenChange={setOpen}
        onAdded={onAdded}
        onNoTopics={onNoTopics}
      />
    </>
  );
}

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <Harness />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  );
const dialog = () => document.querySelector('[role="dialog"]');
const review = () => container.querySelector<HTMLElement>('[data-topic-prompts]');
const reviewBoxes = () => [...(review()?.querySelectorAll<HTMLElement>('[role="checkbox"]') ?? [])];
const reviewTexts = () => [...(review()?.querySelectorAll('li p') ?? [])].map((p) => p.textContent);

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setValue.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function generate() {
  await render();
  await act(async () => button('Generate')!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  isLocked = false;
  viewer.canManage = true;
  topicActions.getTopics.mockResolvedValue(TOPICS);
  setup.generatePromptsFromTopics.mockImplementation(written());
  promptActions.importPrompts.mockImplementation(async (_brandId: string, rows: unknown[]) => ({
    importedIdx: rows.map((_, i) => i),
    promptIds: rows.map((_, i) => `p${i}`),
    analysisStarted: true,
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('Generate by topic — picking topics', () => {
  it('lists the brand’s topics, every one picked, and says how many prompts that makes', async () => {
    await render();
    expect(dialog()?.textContent).toContain('Generate prompts by topic');
    const boxes = [...dialog()!.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
    // Each box has its topic as its label.
    expect(boxes.map((b) => document.querySelector(`label[for="${b.id}"]`)?.textContent)).toEqual([
      'Coffee',
      'Tea',
      'Mugs',
    ]);
    expect(dialog()!.textContent).toContain('3 topics picked · 15 prompts');
    await act(async () => boxes[2].click());
    expect(dialog()!.textContent).toContain('2 topics picked · 10 prompts');
  });

  it('asks the brand page’s generation call for the picked topics only, with the brand', async () => {
    await render();
    const mugs = [...dialog()!.querySelectorAll<HTMLElement>('[role="checkbox"]')][2];
    await act(async () => mugs.click());
    await act(async () => button('Generate')!.click());
    expect(setup.generatePromptsFromTopics).toHaveBeenCalledExactlyOnceWith(
      {
        brandName: 'Acme',
        industry: 'Coffee',
        description: 'Coffee subscriptions',
        website: 'acme.com',
        language: 'en',
      },
      ['Coffee', 'Tea'],
    );
    // The picker closes; the prompts wait for review where the suggestions are.
    expect(dialog()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      '10 prompts written: review them at the top of the suggestions.',
    );
  });

  it('can’t generate with no topic picked', async () => {
    await render();
    await act(async () => button('Clear all')!.click());
    expect(button('Generate')!.disabled).toBe(true);
    expect(dialog()!.textContent).toContain('0 topics picked · 0 prompts');
  });

  it('asks for a topic first on a brand without one, with nothing to generate', async () => {
    topicActions.getTopics.mockResolvedValue([]);
    await render();
    expect(dialog()!.textContent).toContain('Add a topic first');
    expect(button('Generate')).toBeUndefined();
  });

  it('says when the day’s prompt ideas are used up, and lists nothing', async () => {
    setup.generatePromptsFromTopics.mockRejectedValue(
      new setup.SetupDailyLimitError('Failed to generate prompts'),
    );
    await generate();
    expect(toast.error).toHaveBeenCalledWith(
      "You've used today's prompt ideas. Try again tomorrow, or add prompts yourself.",
    );
    expect(review()).toBeNull();
    // The picker stays open to try again later.
    expect(dialog()).not.toBeNull();
  });

  it('says a failed generation in plain words', async () => {
    setup.generatePromptsFromTopics.mockRejectedValue(new Error('Failed to generate prompts'));
    await generate();
    expect(toast.error).toHaveBeenCalledWith("Couldn't generate prompts. Try again.");
    expect(review()).toBeNull();
  });

  it('shows nothing to those who can’t add prompts', async () => {
    viewer.canManage = false;
    await render();
    expect(dialog()).toBeNull();
    expect(container.textContent).toBe('open picker');
  });
});

describe('Generate by topic — reviewing what was written', () => {
  it('groups the prompts by topic, 5 each, every one ticked', async () => {
    await generate();
    expect(review()!.querySelector('h3')!.textContent).toBe('Generated for Coffee, Tea, Mugs');
    expect([...review()!.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
      'Coffee',
      'Tea',
      'Mugs',
    ]);
    expect(reviewBoxes()).toHaveLength(15);
    expect(reviewBoxes().every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(reviewBoxes()[0].getAttribute('aria-label')).toBe('Include “best coffee idea 1”');
    expect(button('Add selected (15)')).toBeDefined();
  });

  it('adds the ticked ones, as edited, under their topic with the plan’s engines and the brand’s location', async () => {
    await generate();
    // Untick Tea's first, and edit Coffee's second.
    await act(async () => reviewBoxes()[5].click());
    await act(async () => button('Edit “best coffee idea 2” before adding')!.click());
    const input = review()!.querySelector<HTMLInputElement>('input')!;
    await act(async () => type(input, '  best   decaf coffee beans  '));
    await act(async () => input.form!.requestSubmit());
    expect(reviewTexts()[1]).toBe('best decaf coffee beansEdited');

    await act(async () => button('Add selected (14)')!.click());
    expect(promptActions.importPrompts).toHaveBeenCalledOnce();
    const [brandId, rows] = promptActions.importPrompts.mock.calls[0];
    expect(brandId).toBe('b1');
    expect(rows).toHaveLength(14);
    expect(rows[1]).toEqual({
      idx: 1,
      text: 'best decaf coffee beans',
      topic: 'Coffee',
      topicId: 't1',
      platforms: ['chatgpt-web', 'gemini-web'],
      models: [],
      regions: ['GB'],
    });
    expect(rows.map((r: { topic: string }) => r.topic)).toEqual([
      ...Array(5).fill('Coffee'),
      ...Array(4).fill('Tea'),
      ...Array(5).fill('Mugs'),
    ]);
    expect(rows.some((r: { text: string }) => r.text === 'best tea idea 1')).toBe(false);

    // Saved: the list goes, the page reads its prompts again, and it says so.
    expect(review()).toBeNull();
    expect(onAdded).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenLastCalledWith('14 prompts added to your tracked list', {
      description: 'Tracking them now.',
    });
  });

  it('names each prompt’s topic by its id, so a topic renamed since generating keeps them', async () => {
    await generate();
    // Coffee is renamed Espresso, and Tea renamed Coffee, while the list waits.
    topicActions.getTopics.mockResolvedValue([
      topic('t1', 'Espresso'),
      topic('t2', 'Coffee'),
      topic('t3', 'Mugs'),
    ]);
    await act(async () => button('Add selected (15)')!.click());
    const rows = promptActions.importPrompts.mock.calls[0][1];
    // The server files them by id, under the topic's name now; the name it had goes along.
    expect(rows.map((r: { topicId?: string }) => r.topicId)).toEqual([
      ...Array(5).fill('t1'),
      ...Array(5).fill('t2'),
      ...Array(5).fill('t3'),
    ]);
    expect(rows[0]).toMatchObject({ topic: 'Coffee', topicId: 't1' });
  });

  it('names the topic by its name only when it has no id', async () => {
    topicActions.getTopics.mockResolvedValue([topic('', 'Coffee')]);
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: [{ topic: 'Coffee', prompts: ['best coffee idea 1'] }],
    });
    await generate();
    await act(async () => button('Add selected (1)')!.click());
    const [row] = promptActions.importPrompts.mock.calls[0][1];
    expect(row).toMatchObject({ text: 'best coffee idea 1', topic: 'Coffee' });
    expect(row).not.toHaveProperty('topicId');
  });

  it('Esc drops an edit, keeping the text as written', async () => {
    await generate();
    await act(async () => button('Edit “best coffee idea 1” before adding')!.click());
    const input = review()!.querySelector<HTMLInputElement>('input')!;
    await act(async () => type(input, 'something else'));
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(review()!.querySelector('input')).toBeNull();
    expect(reviewTexts()[0]).toBe('best coffee idea 1');
  });

  it('says which were already tracked, and those waiting for a spot', async () => {
    promptActions.importPrompts.mockResolvedValue({
      importedIdx: [0, 1, 2],
      promptIds: ['p0', 'p1', 'p2'],
      waitingIdx: [2],
      analysisStarted: true,
    });
    await generate();
    await act(async () => button('Add selected (15)')!.click());
    // Past the plan's limit: the waiting toast, as every other add says it.
    expect(toast.warning).toHaveBeenCalledWith('2 added, 1 waiting for a spot', expect.anything());
    expect(toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining('added'),
      expect.anything(),
    );

    promptActions.importPrompts.mockResolvedValue({
      importedIdx: [0, 1],
      promptIds: ['p0', 'p1'],
      analysisStarted: false,
    });
    await act(async () => button('open picker')!.click());
    await act(async () => {});
    await act(async () => button('Generate')!.click());
    await act(async () => button('Add selected (15)')!.click());
    expect(toast.success).toHaveBeenLastCalledWith(
      '2 prompts added · 13 not added: already tracked',
      { description: 'They get their first answers with the next tracking run.' },
    );
  });

  it('keeps the list when nothing could be added, or the save failed', async () => {
    promptActions.importPrompts.mockResolvedValue({
      importedIdx: [],
      promptIds: [],
      analysisStarted: false,
    });
    await generate();
    await act(async () => button('Add selected (15)')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      'Nothing was added: these prompts are already tracked.',
    );
    expect(review()).not.toBeNull();

    promptActions.importPrompts.mockResolvedValue({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    await act(async () => button('Add selected (15)')!.click());
    expect(onNoTopics).toHaveBeenCalledOnce();
    expect(review()).not.toBeNull();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('Regenerate asks again for the same topics and replaces the list', async () => {
    await render();
    const tea = [...dialog()!.querySelectorAll<HTMLElement>('[role="checkbox"]')][1];
    await act(async () => tea.click());
    await act(async () => button('Generate')!.click());
    setup.generatePromptsFromTopics.mockImplementation(written('top'));
    await act(async () => button('Regenerate')!.click());
    expect(setup.generatePromptsFromTopics).toHaveBeenCalledTimes(2);
    expect(setup.generatePromptsFromTopics.mock.calls[1][1]).toEqual(['Coffee', 'Mugs']);
    expect(reviewTexts()[0]).toBe('top coffee idea 1');
    expect(reviewBoxes()).toHaveLength(10);
  });

  it('Dismiss drops the list, saving nothing', async () => {
    await generate();
    await act(async () => button('Dismiss')!.click());
    expect(review()).toBeNull();
    expect(promptActions.importPrompts).not.toHaveBeenCalled();
  });

  it('keeps a topic’s prompts under it when the API spells the topic its own way', async () => {
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: [
        { topic: 'coffee ', prompts: ['best coffee idea 1'] },
        { topic: 'TEA', prompts: ['best tea idea 1'] },
        // Renamed, but every topic came back in the order asked: the third is Mugs.
        { topic: 'Mug', prompts: ['best mug idea 1'] },
      ],
    });
    await generate();
    await act(async () => button('Add selected (3)')!.click());
    expect(
      promptActions.importPrompts.mock.calls[0][1].map((r: { topic: string }) => r.topic),
    ).toEqual(['Coffee', 'Tea', 'Mugs']);
  });

  it('leaves out prompts under a topic the brand doesn’t have', async () => {
    setup.generatePromptsFromTopics.mockResolvedValue({
      topicPrompts: [
        { topic: 'Coffee', prompts: ['best coffee idea 1'] },
        { topic: 'Something else', prompts: ['stray idea'] },
      ],
    });
    await generate();
    expect(reviewTexts()).toEqual(['best coffee idea 1']);
    await act(async () => button('Add selected (1)')!.click());
    expect(promptActions.importPrompts.mock.calls[0][1]).toEqual([
      expect.objectContaining({ text: 'best coffee idea 1', topic: 'Coffee' }),
    ]);
  });

  it('opens the upgrade dialog from Add selected and Regenerate once the plan has ended', async () => {
    await generate();
    isLocked = true;
    await render();
    await act(async () => button('Add selected (15)')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Adding prompts needs a plan');
    await act(async () => button('Regenerate')!.click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating prompts needs a plan');
    expect(promptActions.importPrompts).not.toHaveBeenCalled();
    expect(setup.generatePromptsFromTopics).toHaveBeenCalledOnce();
  });
});
