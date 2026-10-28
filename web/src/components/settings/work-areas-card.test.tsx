import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { MyMenu } from '@/lib/actions/menu-access';

/**
 * Settings › Account › Your work areas: the person picks what they work on or
 * lead, saved as it changes; the menu it leaves them says why a section is off.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));

let canAdmin = false;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: canAdmin ? 'admin' : 'analyst', canManage: canAdmin, canAdmin }),
}));

const actions = vi.hoisted(() => ({ getMyMenu: vi.fn(), setMyWorkAreas: vi.fn() }));
vi.mock('@/lib/actions/menu-access', () => actions);

const { WorkAreasCard, menuWithWorkAreas } = await import('./work-areas-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const menu = (over: Partial<MyMenu> = {}): MyMenu => ({
  hidden: [],
  hiddenByAdmin: [],
  workAreas: [],
  workAreasAsked: true,
  canManageMenus: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  canAdmin = false;
  actions.setMyWorkAreas.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(start: MyMenu) {
  actions.getMyMenu.mockResolvedValue(start);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkAreasCard />
      </NextIntlClientProvider>,
    );
  });
}

const chip = (text: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;
const section = (id: string) => container.querySelector(`[data-section="${id}"]`) as HTMLElement;

describe('menuWithWorkAreas', () => {
  it('keeps what the admin takes off and narrows the rest to the areas', () => {
    const next = menuWithWorkAreas(menu({ hiddenByAdmin: ['mentions'] }), ['brand']);
    expect(next.workAreas).toEqual(['brand']);
    expect(next.hidden).toEqual(['content', 'audit', 'prompts', 'mentions', 'shopping', 'traffic']);
    expect(menuWithWorkAreas(next, []).hidden).toEqual(['mentions']);
  });
});

describe('WorkAreasCard', () => {
  it('shows the picked areas and why each section is off', async () => {
    await render(
      menu({
        workAreas: ['brand'],
        hiddenByAdmin: ['mentions'],
        hidden: ['content', 'audit', 'prompts', 'mentions', 'shopping', 'traffic'],
      }),
    );
    expect(chip('Brand & PR').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Everything').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('5 of 11 sections');
    expect(section('mentions').textContent).toContain('Hidden by your admin');
    expect(section('content').textContent).toContain('Not in your work areas');
    expect(section('insights').textContent).not.toContain('Not in');
    expect(container.textContent).toContain('Your admin took a section off your menu.');
  });

  it('saves the areas as they change, in the list’s order', async () => {
    await render(menu({ workAreas: ['brand'] }));
    await act(async () => chip('Founders & leaders').click());
    expect(actions.setMyWorkAreas).toHaveBeenCalledWith(['leaders', 'brand']);
    expect(chip('Founders & leaders').getAttribute('aria-pressed')).toBe('true');
    expect(refresh).toHaveBeenCalled();

    await act(async () => chip('Everything').click());
    expect(actions.setMyWorkAreas).toHaveBeenLastCalledWith([]);
    expect(container.textContent).toContain('11 of 11 sections');
  });

  it('puts the areas back when the save fails', async () => {
    actions.setMyWorkAreas.mockRejectedValueOnce(new Error('nope'));
    await render(menu());
    await act(async () => chip('Growth').click());
    expect(chip('Growth').getAttribute('aria-pressed')).toBe('false');
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the menu. Try again.");
  });

  it('tells admins nobody else narrows their menu', async () => {
    canAdmin = true;
    await render(menu());
    expect(container.textContent).toContain("Nobody else can take a section off an admin's menu.");
  });
});
