import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SiteTrust } from '@/lib/content/site-trust';

const getSiteTrust = vi.fn();
vi.mock('@/lib/actions/audits', () => ({
  getSiteTrust: (...args: unknown[]) => getSiteTrust(...args),
}));

const { SiteTrustCard } = await import('./_site-trust-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Site trust in Site Audit (CE-043): five checks, each passing or saying what to add. */

const TRUST: SiteTrust = {
  checks: {
    about: { ok: true, url: 'https://acme.com/about' },
    contact: { ok: true, url: 'https://acme.com/contact' },
    editorial: { ok: false, url: null },
    organizationSchema: { ok: true, url: 'https://acme.com/' },
    authorPages: {
      ok: false,
      authors: [
        { name: 'Ada Lovelace', url: 'https://acme.com/authors/ada-lovelace' },
        { name: 'Bob Stone', url: null },
      ],
    },
  },
  score: 3,
  checkedAt: '2026-10-23T12:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getSiteTrust.mockReset().mockResolvedValue(TRUST);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SiteTrustCard brandId="b1" />
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('li')].map((li) => li.textContent);

describe('SiteTrustCard', () => {
  it('shows the score and each check, with its page or what to add', async () => {
    await render();
    expect(getSiteTrust).toHaveBeenCalledWith('b1', false);
    expect(container.querySelector('#site-trust')!.textContent).toContain('Site trust 3/5');
    expect(rows()).toEqual([
      'About page · passesFound on your site.Open',
      'Contact page · passesFound on your site.Open',
      'Editorial policy · missingAdd a page on how you write and check content, at /editorial-policy or /how-we-review.',
      'Organization schema on the home page · passesYour home page names your organization in its JSON-LD.Open',
      'Author pages · missingNo page found for: Bob Stone. Add one for each, such as /authors/their-name.',
    ]);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://acme.com/about');
  });

  it('reads it again on Check again', async () => {
    await render();
    const again = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check again',
    )!;
    await act(async () => again.click());
    expect(getSiteTrust).toHaveBeenLastCalledWith('b1', true);
  });

  it('asks for authors first when there are none', async () => {
    getSiteTrust.mockResolvedValue({
      ...TRUST,
      checks: { ...TRUST.checks, authorPages: { ok: false, authors: [] } },
    });
    await render();
    expect(rows()[4]).toContain('Add your authors in Settings › Authors');
  });

  it("says so when it can't be read", async () => {
    getSiteTrust.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    expect(container.textContent).toContain("Couldn't read your site trust.");
  });
});
