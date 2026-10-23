import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import type { ApiFailure } from '@/lib/api-failure';
import { useFailureToast } from './use-failure-toast';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Shows the failure's toast once, and returns what toast.error got. */
function show(failure: ApiFailure, options?: { id?: string; description?: string }) {
  toast.error.mockReset();
  push.mockReset();
  function Probe() {
    const failureToast = useFailureToast();
    failureToast(failure, options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    ),
  );
  act(() => root.unmount());
  return toast.error.mock.calls[0] as [string, { action?: { label: string; onClick: () => void } }];
}

describe('useFailureToast (BUG-001)', () => {
  it('says another workspace’s brand plainly, and offers the member’s brands', () => {
    const [message, options] = show('workspace');
    expect(message).toBe("This brand isn't in your workspace. Switch to one of your brands.");
    expect(options.action?.label).toBe('Your brands');
    options.action?.onClick();
    expect(push).toHaveBeenCalledWith('/dashboard/brands');
  });

  it('asks to sign in again for an expired session, and to upgrade for a limit', () => {
    expect(show('session')[1].action?.label).toBe('Sign in');
    const [message, options] = show('limit', { id: 't1' });
    expect(message).toBe("You've used this month's allowance. Upgrade, or wait until it resets.");
    expect(options).toMatchObject({ id: 't1', action: { label: 'Upgrade' } });
  });

  it('asks to wait a minute for a rate limit, with nothing to click', () => {
    const [message, options] = show('busy');
    expect(message).toBe('Too many requests. Wait a minute and try again.');
    expect(options.action).toBeUndefined();
  });

  it('offers nothing to click for a plain failure', () => {
    const [message, options] = show('failed');
    expect(message).toBe('Something went wrong. Try again.');
    expect(options.action).toBeUndefined();
  });
});
