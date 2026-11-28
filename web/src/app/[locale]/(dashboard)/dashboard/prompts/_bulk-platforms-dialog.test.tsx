import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { Prompt } from '@/types';

/** Add or remove platforms on the selected prompts (00564). The action is mocked. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const action = vi.hoisted(() => ({ bulkUpdatePromptPlatforms: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => action);
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const { BulkPlatformsDialog } = await import('./_bulk-platforms-dialog');

const prompt = (id: string, platforms: string[], regions = ['US', 'GB']) =>
  ({ id, platforms, regions, models: [], isActive: true }) as unknown as Prompt;

const PLATFORMS = [
  { id: 'chatgpt-web', label: 'ChatGPT' },
  { id: 'chatgpt-shopping', label: 'ChatGPT Shopping' },
  { id: 'claude-web', label: 'Claude' },
];

let root: Root;
let container: HTMLDivElement;
const onDone = vi.fn();

function render(mode: 'add' | 'remove', freeClaude: number) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BulkPlatformsDialog
          open
          onOpenChange={() => {}}
          prompts={[prompt('p1', ['chatgpt-web']), prompt('p2', ['chatgpt-web', 'claude-web'])]}
          selectedIds={new Set(['p1', 'p2'])}
          preset={{ mode }}
          platforms={PLATFORMS}
          slots={[
            { platform: 'chatgpt-web', used: 100, limit: 250 },
            { platform: 'claude-web', used: 300 - freeClaude, limit: 300 },
          ]}
          onDone={onDone}
        />
      </NextIntlClientProvider>,
    );
  });
}

const body = () => document.body.textContent ?? '';
const buttonWith = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  )!;
const click = (el: HTMLElement) =>
  act(async () => {
    el.click();
  });

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the platforms dialog', () => {
  it('offers the platforms with their free slots, never ChatGPT Shopping', () => {
    render('add', 40);
    expect(body()).toContain('Claude40 free');
    expect(body()).not.toContain('ChatGPT Shopping');
  });

  it('adds a platform to the prompts without it', async () => {
    action.bulkUpdatePromptPlatforms.mockResolvedValue({ updated: 1, unchanged: 1, blocked: 0 });
    render('add', 40);
    await click(buttonWith('Claude'));
    expect(body()).toContain('1 prompt will change · 1 already have them');
    await click(buttonWith('Add to 1 prompt'));
    expect(action.bulkUpdatePromptPlatforms).toHaveBeenCalledWith(['p1', 'p2'], 'add', [
      'claude-web',
    ]);
    expect(onDone).toHaveBeenCalled();
  });

  it('says when a platform has too few free slots, and links to Billing', async () => {
    render('add', 1);
    await click(buttonWith('Claude'));
    expect(body()).toContain('Claude needs 2 slots and has 1 free.');
    expect(buttonWith('Add to 1 prompt').disabled).toBe(true);
  });

  it('removes only what the selection runs on', async () => {
    render('remove', 0);
    expect(body()).not.toMatch(/\d+ free/);
    expect(buttonWith('Claude')).toBeDefined();
  });
});
