import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_OPTIONS, scrubEvent } from '@/lib/analytics-privacy';

/**
 * PostHog starts with the replay masking and the URL cleaning from
 * analytics-privacy.ts (SEC-10a), and not at all without a key.
 */

const posthog = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('posthog-js', () => ({ default: posthog }));

const { PostHogProvider } = await import('./posthog-provider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
  vi.unstubAllEnvs();
});

describe('PostHogProvider', () => {
  it('masks inputs, leaves secrets out of replays and cleans URLs', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    act(() => root.render(<PostHogProvider />));
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [key, config] = posthog.init.mock.calls[0];
    expect(key).toBe('phc_test');
    expect(config).toMatchObject({
      autocapture: false,
      session_recording: REPLAY_OPTIONS,
      before_send: scrubEvent,
    });
    expect(config.session_recording.maskAllInputs).toBe(true);
  });

  it('records heatmaps, and no dead-click events with element text, whatever the project says', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    act(() => root.render(<PostHogProvider />));
    const [, config] = posthog.init.mock.calls[0];
    expect(config).toMatchObject({
      autocapture: false,
      enable_heatmaps: true,
      capture_dead_clicks: false,
    });
  });

  it('starts nothing without a key', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    act(() => root.render(<PostHogProvider />));
    expect(posthog.init).not.toHaveBeenCalled();
  });
});
