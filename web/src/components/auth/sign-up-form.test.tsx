import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AnyUiLocale } from '@/i18n/locales';

/**
 * Sign-up from an invitation link (`?invite=…&email=…&next=/invite/…`): the
 * form keeps the invited address and the way back, and the link's token and
 * address leave the address bar once read (SEC-10a).
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const router = vi.hoisted(() => ({ push: () => {}, refresh: () => {} }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const setSignUpUiLanguage = vi.hoisted(() => ({
  fn: async (locale: string): Promise<void> => void locale,
}));
vi.mock('@/lib/actions/ui-language', () => ({
  setSignUpUiLanguage: (locale: string) => setSignUpUiLanguage.fn(locale),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const oauthNext = vi.hoisted(() => [] as (string | null | undefined)[]);
vi.mock('@/components/auth/oauth-buttons', () => ({
  OAuthButtons: ({ next }: { next?: string | null }) => {
    oauthNext.push(next);
    return null;
  },
}));

const { SignUpForm } = await import('./sign-up-form');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  oauthNext.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

function render(languages?: { options: AnyUiLocale[]; selected: AnyUiLocale }) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SignUpForm languages={languages} />
      </NextIntlClientProvider>,
    ),
  );
}

const emailInput = () => container.querySelector<HTMLInputElement>('#email')!;

describe('SignUpForm', () => {
  it("takes an invitation's token and address out of the address bar, and keeps them", () => {
    window.history.replaceState(
      null,
      '',
      '/en/sign-up?invite=tok_123&email=cal%40acme.test&next=%2Fen%2Finvite%2Ftok_123',
    );
    render();
    expect(window.location.pathname).toBe('/en/sign-up');
    expect(window.location.search).toBe('');

    // Drawn again with the clean address: the form still has what it read.
    render();
    expect(emailInput().value).toBe('cal@acme.test');
    expect(emailInput().disabled).toBe(true);
    expect(oauthNext.at(-1)).toBe('/en/invite/tok_123');
  });

  it('labels the address Email, and only suggests a work one', () => {
    render();
    expect(container.querySelector('label[for="email"]')?.textContent).toBe('Email');
    expect(container.querySelector('#email-hint')?.textContent).toBe('Work email suggested');
    expect(emailInput().getAttribute('aria-describedby')).toBe('email-hint');
    // A suggestion, not a rule: any address is accepted.
    expect(emailInput().type).toBe('email');
    expect(emailInput().getAttribute('pattern')).toBeNull();
  });

  it('leaves a sign-up without an invitation as it is', () => {
    window.history.replaceState(null, '', '/en/sign-up?next=%2Fen%2Fdashboard%2Fchat');
    render();
    expect(window.location.search).toBe('?next=%2Fen%2Fdashboard%2Fchat');
    expect(emailInput().value).toBe('');
    expect(emailInput().disabled).toBe(false);
    expect(oauthNext.at(-1)).toBe('/en/dashboard/chat');
  });
});

/**
 * The Language field: the language of the screens before the account exists,
 * kept in the visitor's cookie by setSignUpUiLanguage, then the page reloads.
 */
describe('SignUpForm: Language', () => {
  const languageSelect = () => container.querySelector<HTMLSelectElement>('#signup-language');

  async function pick(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('is hidden while only one language is offered', () => {
    render({ options: ['en'], selected: 'en' });
    expect(languageSelect()).toBeNull();
    render();
    expect(languageSelect()).toBeNull();
  });

  it('lists each offered language in its own name, the given one picked', () => {
    render({ options: ['en', 'tr', 'de'], selected: 'tr' });
    const select = languageSelect()!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['English', 'Türkçe', 'Deutsch']);
    expect(select.value).toBe('tr');
    expect(container.querySelector('label[for="signup-language"]')?.textContent).toBe('Language');
  });

  it('keeps a pick through the action, then reloads the page in it', async () => {
    const picked: string[] = [];
    setSignUpUiLanguage.fn = async (locale) => {
      picked.push(locale);
    };
    const refresh = vi.spyOn(router, 'refresh');
    render({ options: ['en', 'tr'], selected: 'en' });
    await pick(languageSelect()!, 'tr');
    expect(picked).toEqual(['tr']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(languageSelect()!.value).toBe('tr');
  });

  it('goes back to the earlier language when the pick fails', async () => {
    setSignUpUiLanguage.fn = async () => {
      throw new Error('Unknown language');
    };
    render({ options: ['en', 'tr'], selected: 'en' });
    await pick(languageSelect()!, 'tr');
    expect(languageSelect()!.value).toBe('en');
  });
});
