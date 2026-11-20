import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** The invitation card, worded from the messages in the reader's language (LOC). */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/actions/team', () => ({ acceptInvitation: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AcceptInvitationCard } = await import('./accept-invitation-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(words: typeof messages, emailMatches = true) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={words} timeZone="UTC">
        <AcceptInvitationCard
          token="tok"
          organizationName="Acme"
          email="ada@acme.example"
          role="agency_partner"
          currentUserEmail={emailMatches ? 'ada@acme.example' : 'bob@other.example'}
          emailMatches={emailMatches}
        />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('AcceptInvitationCard', () => {
  it('names the team and the role, and asks for a password', () => {
    const text = render(messages);
    expect(text).toContain('Join Acme');
    expect(text).toContain("You've been invited to join as Agency Partner");
    expect(text).toContain('Accept and join Acme');
    expect(container.querySelector('span.font-medium.text-foreground')?.textContent).toBe(
      'Agency Partner',
    );
  });

  it('asks to switch accounts when another one is signed in', () => {
    const text = render(messages, false);
    expect(text).toContain(
      "This invitation was sent to ada@acme.example, but you're signed in as bob@other.example.",
    );
    expect(text).toContain('Sign out and use correct account');
  });

  it('words the card from the messages', () => {
    const card = messages.invite.card;
    const text = render({
      ...messages,
      invite: {
        ...messages.invite,
        card: { ...card, title: '{organization} ekibine katılın', accept: 'Kabul et ve katıl' },
      },
    });
    expect(text).toContain('Acme ekibine katılın');
    expect(text).toContain('Kabul et ve katıl');
    expect(text).not.toContain('Join Acme');
  });
});
