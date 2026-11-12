import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A new person starts on the dark theme (owner decision 2026-11-10); a
 * browser that already has a theme keeps it, so no one who uses Ansvisor
 * today changes.
 */

const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => theme }));

const { NewUserTheme, newUserThemeScript } = await import('./new-user-theme');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

/** Runs the page's inline script as the browser would, before React. */
function runScript() {
  new Function(newUserThemeScript('dark', 'theme'))();
}

describe('the script, before the page paints', () => {
  it('starts a browser with no theme on dark, and stores it', () => {
    document.documentElement.classList.add('light');
    runScript();
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('leaves a theme the person picked alone', () => {
    window.localStorage.setItem('theme', 'light');
    runScript();
    expect(window.localStorage.getItem('theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('is what the page carries on Ansvisor Cloud, and nothing self-hosted', () => {
    expect(renderToStaticMarkup(<NewUserTheme />)).toContain(newUserThemeScript('dark', 'theme'));
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(renderToStaticMarkup(<NewUserTheme />)).toBe('');
  });
});

describe('a page reached in the app', () => {
  it('switches a browser with no theme to dark', () => {
    act(() => root.render(<NewUserTheme />));
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });

  it('keeps a theme the browser already has', () => {
    window.localStorage.setItem('theme', 'light');
    act(() => root.render(<NewUserTheme />));
    expect(theme.setTheme).not.toHaveBeenCalled();
  });

  it('does nothing self-hosted', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    act(() => root.render(<NewUserTheme />));
    expect(theme.setTheme).not.toHaveBeenCalled();
  });
});
