import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Settings › Team on a read-only workspace (plan not active): Invite, a
 * role and Resend open the upgrade dialog instead, and change nothing.
 * Remove and Revoke still work: they end access. On an active plan all work.
 */

const team = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  getTeamInfo: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  inviteMember: vi.fn(),
}));
vi.mock('@/lib/actions/team', () => team);
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TeamSection } = await import('./team-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const ME = {
  userId: 'u1',
  email: 'ada@acme.test',
  fullName: 'Ada Admin',
  avatarUrl: null,
  role: 'admin',
  createdAt: '2026-01-01',
  isCurrentUser: true,
};
const BOB = { ...ME, userId: 'u2', email: 'bob@acme.test', fullName: 'Bob', role: 'analyst' };
BOB.isCurrentUser = false;
const INVITE = {
  id: 'i1',
  email: 'cal@acme.test',
  role: 'analyst',
  status: 'pending',
  invitedBy: 'u1',
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-10-01',
  acceptedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  team.listMembers.mockResolvedValue([ME, BOB]);
  team.listInvitations.mockResolvedValue([INVITE]);
  team.getTeamInfo.mockResolvedValue({
    memberCount: 2,
    pendingCount: 1,
    seatsUsed: 3,
    maxTeamMembers: 5,
    canInvite: true,
    planName: 'Growth',
  });
  team.removeMember.mockResolvedValue(undefined);
  team.revokeInvitation.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <TeamSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const byText = (text: string) =>
  [...document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (b) => b.textContent?.trim() === text,
  );
const byLabel = (label: string) =>
  document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element | undefined) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const dialog = () => document.querySelector('[role="dialog"]');

describe('TeamSection on a read-only workspace', () => {
  it('invites and resends nothing: each opens the upgrade dialog', async () => {
    await render(true);
    await click(byText('Invite member'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Inviting members needs a plan');
    expect(dialog()).toBeNull();

    await click(byLabel('Invitation actions'));
    await click(byText('Resend invite'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Resending invitations needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(team.inviteMember).not.toHaveBeenCalled();
    expect(team.resendInvitation).not.toHaveBeenCalled();
  });

  it('still removes a member and revokes an invitation: they end access', async () => {
    await render(true);
    await click(byLabel('Remove team member'));
    expect(dialog()?.textContent).toContain('Remove');
    await click(byText('Remove member'));
    expect(team.removeMember).toHaveBeenCalledWith('u2');

    await click(byLabel('Invitation actions'));
    await click(byText('Revoke'));
    expect(team.revokeInvitation).toHaveBeenCalledWith('i1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('changes no role: picking one opens the upgrade dialog', async () => {
    await render(true);
    await click(container.querySelector('[role="combobox"]')!);
    const manager = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Manager',
    )!;
    await act(async () => {
      manager.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(manager);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Changing roles needs a plan');
    expect(team.updateMemberRole).not.toHaveBeenCalled();
  });

  it('opens Invite and asks before removing on an active plan', async () => {
    await render(false);
    await click(byText('Invite member'));
    expect(dialog()?.textContent).toContain('Invite');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await click(byLabel('Remove team member'));
    await click(byText('Remove member'));
    expect(team.removeMember).toHaveBeenCalledWith('u2');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
