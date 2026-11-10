import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identify, setPersonProperties } from '@/lib/analytics';

/**
 * The signed-in person in PostHog: identified by their user id, with the
 * workspace's plan on them (ids and states, never a name), kept up to date
 * as the plan changes.
 */

const auth = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
}));

vi.mock('@/lib/analytics', () => ({
  identify: vi.fn(),
  reset: vi.fn(),
  setPersonProperties: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({ setUser: vi.fn(), setLoading: vi.fn() }),
}));

const { AuthProvider } = await import('./auth-provider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

const person = {
  organizationId: 'org-1',
  plan: 'growth',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  role: 'admin',
};
const asStored = {
  organization_id: 'org-1',
  plan: 'growth',
  subscription_status: 'active',
  cancel_at_period_end: false,
  team_role: 'admin',
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.listener = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuthProvider', () => {
  it("identifies the person with the workspace's plan", () => {
    act(() => root.render(<AuthProvider user={null} person={person} />));
    act(() => auth.listener!('INITIAL_SESSION', { user: { id: 'u1', email: 'a@b.co' } }));
    expect(identify).toHaveBeenCalledWith('u1', { email: 'a@b.co', ...asStored });
  });

  it('keeps the plan up to date as it changes, and sends it again only then', () => {
    act(() => root.render(<AuthProvider user={null} person={person} />));
    expect(setPersonProperties).toHaveBeenLastCalledWith(asStored);
    act(() => root.render(<AuthProvider user={null} person={{ ...person }} />));
    expect(setPersonProperties).toHaveBeenCalledTimes(1);
    act(() =>
      root.render(<AuthProvider user={null} person={{ ...person, cancelAtPeriodEnd: true }} />),
    );
    expect(setPersonProperties).toHaveBeenCalledTimes(2);
    expect(setPersonProperties).toHaveBeenLastCalledWith({
      ...asStored,
      cancel_at_period_end: true,
    });
  });

  it('identifies with the e-mail alone where the plan is not known (onboarding)', () => {
    act(() => root.render(<AuthProvider user={null} />));
    act(() => auth.listener!('SIGNED_IN', { user: { id: 'u1', email: 'a@b.co' } }));
    expect(identify).toHaveBeenCalledWith('u1', { email: 'a@b.co' });
    expect(setPersonProperties).not.toHaveBeenCalled();
  });
});
