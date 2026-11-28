import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { WHY_ANSVISOR, WhyAnsvisor } from './why-ansvisor';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('WhyAnsvisor', () => {
  it('shows the four reasons as a labelled list, in order', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <WhyAnsvisor />
        </NextIntlClientProvider>,
      );
    });
    const list = container.querySelector('[data-slot="why-ansvisor"]')!;
    expect(list.getAttribute('aria-label')).toBe('Why Ansvisor');
    const items = [...list.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toHaveLength(WHY_ANSVISOR.length);
    expect(items[0]).toContain('Real answers, not guesses');
    expect(items[1]).toContain('Actions, not only reports');
    expect(items[2]).toContain('Clear price');
    expect(items[3]).toContain('Results you can show');
    act(() => root.unmount());
  });

  it('has every reason in every language', async () => {
    const locales = ['ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'tr', 'zh-CN'];
    for (const locale of locales) {
      const { default: m } = await import(`../../../messages/${locale}.json`);
      for (const key of WHY_ANSVISOR) {
        expect(m.planOffer.why[key].title, `${locale} ${key}`).toBeTruthy();
        expect(m.planOffer.why[key].body, `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});
