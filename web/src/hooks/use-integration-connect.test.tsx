import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The OAuth popup flow shared by Settings › Integrations and AI Traffic's
 * sources strip: open the popup, poll until the account is connected, and
 * stop once the caller is gone.
 */

const actions = vi.hoisted(() => ({
  connectIntegration: vi.fn(),
  getIntegrationStatus: vi.fn(),
}));
vi.mock('@/lib/actions/integrations', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useIntegrationConnect } = await import('./use-integration-connect');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const harness: { connect?: () => Promise<void> } = {};
const connect = () => harness.connect!();
const onStatus = vi.fn();
const popup = { closed: false, close: vi.fn() };

function Harness() {
  const { connect: start } = useIntegrationConnect('google-analytics', {
    label: 'Google Analytics',
    callbackUrl: () => 'https://app.example/dashboard/traffic',
    onStatus,
  });
  useEffect(() => {
    harness.connect = start;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  popup.closed = false;
  actions.connectIntegration.mockResolvedValue({ redirectUrl: 'https://oauth.example/start' });
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useIntegrationConnect', () => {
  it('opens the popup at the OAuth URL and reports the account once connected', async () => {
    actions.getIntegrationStatus
      .mockResolvedValueOnce({ status: 'not_connected' })
      .mockResolvedValueOnce({ status: 'connected' });
    let done!: Promise<void>;
    act(() => {
      done = connect();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
    await done;

    expect(actions.connectIntegration).toHaveBeenCalledWith(
      'google-analytics',
      'https://app.example/dashboard/traffic',
    );
    expect(window.open).toHaveBeenCalledWith(
      'https://oauth.example/start',
      'google-analytics-oauth',
      'width=560,height=720',
    );
    expect(onStatus).toHaveBeenCalledWith('connected');
    expect(popup.close).toHaveBeenCalled();
  });

  it('reports the final status when the user closes the popup', async () => {
    actions.getIntegrationStatus.mockResolvedValue({ status: 'not_connected' });
    let done!: Promise<void>;
    act(() => {
      done = connect();
    });
    popup.closed = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    await done;
    expect(onStatus).toHaveBeenCalledWith('not_connected');
  });

  it('stops polling once its caller is gone', async () => {
    actions.getIntegrationStatus.mockResolvedValue({ status: 'not_connected' });
    act(() => {
      void connect();
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    act(() => root.unmount());
    actions.getIntegrationStatus.mockResolvedValue({ status: 'connected' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onStatus).not.toHaveBeenCalled();
    // Re-mount for afterEach's unmount.
    root = createRoot(container);
  });
});
