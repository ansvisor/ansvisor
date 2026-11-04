import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';

/**
 * Brand settings › People (BRAND-ACCESS §3.2, PR 13): who can see the
 * brand. Admins see why each person does and the way to Team; anyone else
 * the names and roles only.
 */

const listBrandPeople = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/team', () => ({ listBrandPeople }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { PeopleTab } = await import('./_people-tab');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  listBrandPeople.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PeopleTab brandId="b1" />
      </NextIntlClientProvider>,
    );
  });
}

const ADA = {
  userId: 'u1',
  name: 'Ada',
  email: 'ada@acme.test',
  role: 'admin',
  isCurrentUser: true,
  access: 'all',
};
const MIA = {
  userId: 'u2',
  name: 'Mia Chen',
  email: 'mia@acme.test',
  role: 'manager',
  isCurrentUser: false,
  access: 'shared',
};

describe('PeopleTab', () => {
  it('lists who can see the brand, and why, to an admin', async () => {
    listBrandPeople.mockResolvedValue({ isAdmin: true, isDemo: false, people: [ADA, MIA] });
    await render();
    expect(listBrandPeople).toHaveBeenCalledWith('b1');
    const text = container.textContent ?? '';
    expect(text).toContain('2 people can see this brand');
    expect(text).toContain('AdaYouada@acme.testAll brandsAdmin');
    expect(text).toContain('Mia Chenmia@acme.testShared with themManager');
    expect(container.querySelector('a[href="/dashboard/settings/team"]')?.textContent).toBe(
      'Change who sees which brands in Team',
    );
  });

  it('shows anyone else names and roles only', async () => {
    listBrandPeople.mockResolvedValue({
      isAdmin: false,
      isDemo: false,
      people: [
        { ...ADA, email: null, access: null, isCurrentUser: false },
        { ...MIA, email: null, access: null, isCurrentUser: true },
      ],
    });
    await render();
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    // Initials, name, role: no e-mail, no reason.
    expect(rows).toEqual(['AAdaAdmin', 'MCMia ChenYouManager']);
    expect(container.querySelector('a[href="/dashboard/settings/team"]')).toBeNull();
  });

  it('says the sample brand is everyone’s', async () => {
    listBrandPeople.mockResolvedValue({
      isAdmin: true,
      isDemo: true,
      people: [{ ...ADA, access: null }],
    });
    await render();
    expect(container.textContent).toContain('The sample brand is visible to everyone');
    expect(container.querySelector('a[href="/dashboard/settings/team"]')).toBeNull();
  });

  it('says it couldn’t load, and reads again on Retry', async () => {
    listBrandPeople.mockRejectedValueOnce(new Error('down'));
    await render();
    expect(container.textContent).toContain("Couldn't load who can see this brand.");
    listBrandPeople.mockResolvedValue({ isAdmin: true, isDemo: false, people: [ADA] });
    await act(async () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click(),
    );
    expect(container.textContent).toContain('1 person can see this brand');
  });
});
