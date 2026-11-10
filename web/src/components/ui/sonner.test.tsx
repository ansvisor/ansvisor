import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import { Toaster } from './sonner';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The app's Toaster counts each error toast it shows (error_shown), for the
 * cancel analysis: its kind alone, never its words, which can name a
 * customer, a domain or a server's error.
 */

let container: HTMLDivElement;
let root: Root;

/** Lets sonner's list of toasts catch up: it updates on a timer, a dismissal on a frame. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

const errorShown = () => vi.mocked(track).mock.calls.filter(([event]) => event === 'error_shown');

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A theme of its own: the system's would need matchMedia, which jsdom has not.
  await act(async () => root.render(<Toaster theme="light" />));
});

afterEach(async () => {
  await act(async () => {
    toast.dismiss();
  });
  await settle();
  act(() => root.unmount());
  container.remove();
});

describe('error_shown', () => {
  it('counts an error toast once, by its kind, never its text', async () => {
    await act(async () => {
      toast.error('Acme Corp: couldn’t reach acme.com', { description: 'Server error 500' });
    });
    await settle();
    expect(errorShown()).toEqual([['error_shown', { kind: 'toast' }]]);
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toMatch(/Acme|acme\.com|500/);
  });

  it('leaves other toasts alone', async () => {
    await act(async () => {
      toast.success('Saved');
      toast('Sent to the Action Center');
      toast.warning('Some prompts were skipped');
    });
    await settle();
    expect(track).not.toHaveBeenCalled();
  });

  it('counts a toast updated in place once, and again once it is shown anew', async () => {
    await act(async () => {
      toast.error('Couldn’t save', { id: 'save' });
    });
    await settle();
    await act(async () => {
      toast.error('Couldn’t save, again', { id: 'save' });
    });
    await settle();
    expect(errorShown()).toHaveLength(1);

    await act(async () => {
      toast.dismiss('save');
    });
    await settle();
    await act(async () => {
      toast.error('Couldn’t save', { id: 'save' });
    });
    await settle();
    expect(errorShown()).toHaveLength(2);
  });

  it('counts each of two error toasts', async () => {
    await act(async () => {
      toast.error('One');
      toast.error('Two');
    });
    await settle();
    expect(errorShown()).toHaveLength(2);
  });

  it('counts a toast.promise that failed', async () => {
    await act(async () => {
      toast.promise(Promise.reject(new Error('acme.com refused')), {
        loading: 'Connecting…',
        error: 'Couldn’t connect',
      });
    });
    await settle();
    expect(errorShown()).toEqual([['error_shown', { kind: 'toast' }]]);
  });
});
