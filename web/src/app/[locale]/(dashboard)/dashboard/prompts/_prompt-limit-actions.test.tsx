import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import { PromptLimitActions } from './_prompt-limit-actions';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Where to go at the prompt limit: shown once a person tried to add more,
 * so each counts as an upgrade wall, the plan's limit by its key.
 */

let container: HTMLDivElement;
let root: Root;

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

describe('PromptLimitActions', () => {
  it('offers Starter the upgrade, and counts the wall once', async () => {
    await act(async () => root.render(<PromptLimitActions planId="starter" />));
    await act(async () => root.render(<PromptLimitActions planId="starter" />));
    expect(container.querySelector('a[href="/dashboard/settings?tab=billing"]')).not.toBeNull();
    expect(vi.mocked(track).mock.calls).toEqual([
      ['upgrade_wall_shown', { feature: 'max_prompts', reason: 'plan_limit', source: 'prompts' }],
    ]);
  });

  it('counts the limit on Growth too, where Ansvisor raises it', async () => {
    await act(async () => root.render(<PromptLimitActions planId="growth" />));
    expect(container.textContent).toContain('Contact us');
    expect(track).toHaveBeenCalledWith('upgrade_wall_shown', {
      feature: 'max_prompts',
      reason: 'plan_limit',
      source: 'prompts',
    });
  });
});
