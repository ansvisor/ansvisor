import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Someone who already uses Ansvisor keeps light, the theme they see (owner
 * decision 2026-11-16): a dashboard page saves it in a browser with no theme
 * yet, on Ansvisor Cloud. A browser with a theme keeps it.
 */

const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => theme }));

const { KeepCurrentTheme } = await import('./keep-current-theme');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('KeepCurrentTheme', () => {
  it('saves light in a browser with no theme yet, on Ansvisor Cloud', () => {
    act(() => root.render(<KeepCurrentTheme />));
    expect(theme.setTheme).toHaveBeenCalledTimes(1);
    expect(theme.setTheme).toHaveBeenCalledWith('light');
  });

  it.each(['dark', 'light'])('never changes a saved theme (%s)', (saved) => {
    window.localStorage.setItem('theme', saved);
    act(() => root.render(<KeepCurrentTheme />));
    expect(theme.setTheme).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('theme')).toBe(saved);
  });

  it('does nothing self-hosted', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    act(() => root.render(<KeepCurrentTheme />));
    expect(theme.setTheme).not.toHaveBeenCalled();
  });

  it('does nothing, and draws the page on, when the browser refuses storage', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(() => act(() => root.render(<KeepCurrentTheme />))).not.toThrow();
    expect(read).toHaveBeenCalledWith('theme');
    expect(theme.setTheme).not.toHaveBeenCalled();
  });

  it('draws nothing: no script, so no change before the page paints', () => {
    expect(renderToStaticMarkup(<KeepCurrentTheme />)).toBe('');
  });
});
