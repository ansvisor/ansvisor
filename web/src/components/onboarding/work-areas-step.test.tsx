import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * "What do you work on?": the person picks their work areas and sees the menu
 * they give; Continue or Skip saves (so it isn't asked again) and moves on.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const actions = vi.hoisted(() => ({ setMyWorkAreas: vi.fn() }));
vi.mock('@/lib/actions/menu-access', () => actions);

const { WorkAreasStep } = await import('./work-areas-step');
const { WelcomeView } = await import('@/app/[locale]/(onboarding)/dashboard/welcome/_welcome-view');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  actions.setMyWorkAreas.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith(text),
  ) as HTMLButtonElement;
const menu = () => [...container.querySelectorAll('[data-section]')].map((li) => li.textContent);

describe('WorkAreasStep', () => {
  it('shows every area with its sections, and the whole menu before a pick', async () => {
    await render(<WorkAreasStep title="What do you work on?" lede="Pick." onDone={onDone} />);
    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(9);
    expect(button('Founders & leaders').textContent).toContain(
      'Action Center · Chat · Brand Visibility · Mentions · AI Referral Traffic · Reports',
    );
    expect(container.textContent).toContain('11 of 11 sections');
  });

  it('narrows the menu as areas are picked, and saves them on Continue', async () => {
    await render(<WorkAreasStep title="t" lede="l" onDone={onDone} />);
    act(() => button('Brand & PR').click());
    act(() => button('Developers').click());
    expect(button('Brand & PR').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('9 of 11 sections');
    expect(menu()).not.toContain('Content');
    expect(menu()).not.toContain('Product Visibility');

    await act(async () => button('Continue').click());
    expect(actions.setMyWorkAreas).toHaveBeenCalledWith(['brand', 'developers']);
    expect(onDone).toHaveBeenCalled();
  });

  it('saves no areas on Skip: every section', async () => {
    await render(<WorkAreasStep title="t" lede="l" onDone={onDone} />);
    act(() => button('Growth').click());
    await act(async () => button('Skip: show me everything').click());
    expect(actions.setMyWorkAreas).toHaveBeenCalledWith([]);
    expect(onDone).toHaveBeenCalled();
  });

  it('stays when the save fails', async () => {
    actions.setMyWorkAreas.mockRejectedValueOnce(new Error('nope'));
    await render(<WorkAreasStep title="t" lede="l" onDone={onDone} />);
    await act(async () => button('Continue').click());
    expect(onDone).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your work areas. Try again.");
    expect(button('Continue').disabled).toBe(false);
  });

  it('keeps what the admin took off out of the menu, and says so', async () => {
    await render(
      <WorkAreasStep title="t" lede="l" hiddenByAdmin={['content', 'audit']} onDone={onDone} />,
    );
    expect(container.textContent).toContain('9 of 11 sections');
    expect(container.textContent).toContain('2 hidden by your admin');
  });
});

describe('WelcomeView', () => {
  it('welcomes an invited person to the workspace by name', async () => {
    await render(
      <WelcomeView role="analyst" workspace="Acme Coffee" firstName="Mert" hiddenByAdmin={[]} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe(
      'Welcome to Acme Coffee Workspace, Mert',
    );
    expect(container.textContent).toContain("You've joined as analyst.");
  });

  it('does without a name it doesn’t have', async () => {
    await render(
      <WelcomeView role="manager" workspace="Acme Coffee" firstName="" hiddenByAdmin={[]} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Welcome to Acme Coffee Workspace');
  });

  it('asks an admin what they work on', async () => {
    await render(
      <WelcomeView role="admin" workspace="Acme" firstName="Cihan" hiddenByAdmin={[]} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('What do you work on?');
  });
});
