import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Settings › Account › Language (LOC-005): the person's own screens'
 * language, Automatic by default, each language in its own name, saved as it
 * is picked, and put back when the save fails.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const actions = vi.hoisted(() => ({
  getUiLanguageState: vi.fn(),
  setUiLanguage: vi.fn(),
}));
vi.mock('@/lib/actions/ui-language', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { LanguageField } = await import('./language-field');

let container: HTMLDivElement;
let root: Root;

const customer = {
  selected: null,
  automatic: 'en',
  options: ['en'],
  preview: false,
};
const staff = {
  selected: null,
  automatic: 'en',
  options: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'ja', 'pl', 'zh-CN', 'ko', 'en-XA'],
  preview: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  actions.getUiLanguageState.mockResolvedValue(customer);
  actions.setUiLanguage.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <LanguageField />
      </NextIntlClientProvider>,
    );
  });
}
const rows = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const row = (locale: string) =>
  container.querySelector<HTMLButtonElement>(`[data-locale="${locale}"]`)!;
const checked = () => rows().find((r) => r.getAttribute('aria-checked') === 'true')?.dataset.locale;
async function click(locale: string) {
  await act(async () => {
    row(locale).click();
  });
}

describe('LanguageField', () => {
  it('lists Automatic and only the languages that have a translation, with a note that more come', async () => {
    await render();
    expect(rows().map((r) => r.dataset.locale)).toEqual(['automatic', 'en']);
    expect(row('automatic').textContent).toBe('Automatic (English)');
    expect(checked()).toBe('automatic');
    expect(container.textContent).toContain('More languages are on the way.');
    expect(container.textContent).toContain('content language doesn’t change');
  });

  it('shows staff every language in its own name, with no test mark', async () => {
    actions.getUiLanguageState.mockResolvedValue(staff);
    await render();
    expect(row('tr').textContent).toBe('Türkçe');
    expect(row('de').textContent).toBe('Deutsch');
    expect(row('ja').textContent).toBe('日本語');
    expect(row('zh-CN').textContent).toBe('简体中文');
    expect(row('ko').textContent).toBe('한국어');
    expect(container.querySelector('[data-locale="ar"]')).toBeNull();
    expect(row('en').textContent).toBe('English');
    expect(row('en-XA').textContent).toBe('Pseudo-English');
  });

  it('saves a pick as it is made, reloads the page and says so', async () => {
    actions.getUiLanguageState.mockResolvedValue(staff);
    await render();
    await click('de');
    expect(actions.setUiLanguage).toHaveBeenLastCalledWith('de');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Language saved');
    expect(checked()).toBe('de');
  });

  it('switches back to English, or to Automatic, in one click', async () => {
    actions.getUiLanguageState.mockResolvedValue({ ...staff, selected: 'de' });
    await render();
    expect(checked()).toBe('de');
    await click('en');
    expect(actions.setUiLanguage).toHaveBeenLastCalledWith('en');
    await click('automatic');
    expect(actions.setUiLanguage).toHaveBeenLastCalledWith(null);
    expect(checked()).toBe('automatic');
  });

  it('does nothing for the language already picked', async () => {
    await render();
    await click('automatic');
    expect(actions.setUiLanguage).not.toHaveBeenCalled();
  });

  it('puts the last language back when the save fails', async () => {
    actions.getUiLanguageState.mockResolvedValue({ ...staff, selected: 'tr' });
    actions.setUiLanguage.mockRejectedValue(new Error('down'));
    await render();
    await click('de');
    expect(toast.error).toHaveBeenCalledWith('Couldn’t save your language. Try again.');
    expect(checked()).toBe('tr');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
