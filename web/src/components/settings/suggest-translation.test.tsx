import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * "Suggest a better translation" (LOC-009): offered in any language but
 * English, opens a form that already knows the screen and the language, and
 * sends what the person wrote.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const submit = vi.hoisted(() => ({ submitTranslationSuggestion: vi.fn() }));
vi.mock('@/lib/actions/translation-suggestions', () => submit);
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/dashboard/prompts' }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { SuggestTranslationLink } = await import('./suggest-translation');

let container: HTMLDivElement;
let root: Root;

function draw(locale: string) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SuggestTranslationLink />
      </NextIntlClientProvider>,
    ),
  );
}

function type(id: string, value: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const link = () => container.querySelector('[data-action="suggest-translation"]');
const sendButton = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Send suggestion')!;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  submit.submitTranslationSuggestion.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('SuggestTranslationLink', () => {
  it('is not offered in English, nor in the staff test language', () => {
    draw('en');
    expect(link()).toBeNull();
    draw('en-XA');
    expect(link()).toBeNull();
  });

  it('opens a form that knows the language and the screen, and sends the suggestion', async () => {
    draw('de');
    expect(link()?.textContent).toContain('Suggest a better translation');
    act(() => (link() as HTMLElement).click());

    const dialog = document.querySelector('[data-slot="suggest-translation"]')!;
    expect(dialog.textContent).toContain('Deutsch');
    expect(dialog.textContent).toContain('/dashboard/prompts');
    expect(sendButton().disabled).toBe(true);

    type('suggest-current', 'Neue Eingabe');
    type('suggest-better', 'Neuer Prompt');
    type('suggest-note', 'klingt besser');
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());

    expect(submit.submitTranslationSuggestion).toHaveBeenCalledWith({
      locale: 'de',
      path: '/dashboard/prompts',
      currentText: 'Neue Eingabe',
      suggestion: 'Neuer Prompt',
      note: 'klingt besser',
    });
    expect(toast.success).toHaveBeenCalled();
    expect(document.querySelector('[data-slot="suggest-translation"]')).toBeNull();
  });

  it('keeps the form open and says why when the suggestion is refused', async () => {
    submit.submitTranslationSuggestion.mockResolvedValue({ ok: false, error: 'same' });
    draw('tr');
    act(() => (link() as HTMLElement).click());
    type('suggest-current', 'a');
    type('suggest-better', 'b');
    await act(async () => sendButton().click());
    expect(toast.error).toHaveBeenCalledWith('Your version is the same as the current text.');
    expect(document.querySelector('[data-slot="suggest-translation"]')).not.toBeNull();
  });

  it('takes the text from a click on the screen', () => {
    draw('de');
    act(() => (link() as HTMLElement).click());
    act(() => (document.querySelector('[data-action="pick-text"]') as HTMLElement).click());
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Click the text');
    const page = document.createElement('p');
    page.textContent = '  Gespeichert  ';
    document.body.appendChild(page);
    act(() => page.click());
    expect((document.getElementById('suggest-current') as HTMLTextAreaElement).value).toBe(
      'Gespeichert',
    );
  });
});
