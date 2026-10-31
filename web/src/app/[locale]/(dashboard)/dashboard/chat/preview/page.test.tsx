import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/**
 * The Chat pieces preview (Chat P0, D1 and D2): there only with the new Chat
 * on for the workspace, and every piece and run card in every state on it.
 */

const session = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  orgId: 'org-1',
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { organization_id: session.orgId } }) }),
      }),
    }),
  }),
}));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
// The composer's "Ask your Admin to connect" (B2's requests).
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ChatPiecesPreviewPage from './page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  session.user = { id: 'user-1' };
  session.orgId = 'org-1';
  notFound.mockClear();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  // The live runs tray reads its runs.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ ok: true, runs: [], running: 0, needsYou: 0 })),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render() {
  const ui = await ChatPiecesPreviewPage();
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    ),
  );
}
const slots = (slot: string) => container.querySelectorAll(`[data-slot="${slot}"]`);
/** D1's pieces on their own, without the ones inside D2's run cards. */
const pieces = (slot: string) =>
  [...slots(slot)].filter((el) => !el.closest('[data-slot="cards-preview"]'));

describe('the Chat pieces preview', () => {
  it.each([undefined, '', 'false'])('is not found with CHAT_AGENTIC=%s', async (value) => {
    vi.stubEnv('CHAT_AGENTIC', value);
    await expect(ChatPiecesPreviewPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("is not found for a workspace Chat isn't on for", async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2, org-3');
    await expect(ChatPiecesPreviewPage()).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2, ORG-1');
    await render();
    expect(container.querySelector('h1')!.textContent).toBe('Chat pieces');
  });

  it('is not found signed out', async () => {
    session.user = null;
    await expect(ChatPiecesPreviewPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows every piece in every state', async () => {
    await render();
    expect(notFound).not.toHaveBeenCalled();
    // 5 states in 3 sizes, the live answer's (W1-14), and the 5 still ones of the Agents list.
    const avatars = pieces('agent-avatar') as HTMLElement[];
    const states = new Set(['idle', 'working', 'waiting', 'done', 'failed']);
    const live = avatars.filter((el) => el.dataset.tone === 'live');
    const muted = avatars.filter((el) => el.dataset.tone === 'muted');
    expect(live).toHaveLength(16);
    expect(new Set(live.map((el) => el.dataset.state))).toEqual(states);
    expect(muted).toHaveLength(5);
    expect(new Set(muted.map((el) => el.dataset.state))).toEqual(states);
    expect(pieces('status-pill')).toHaveLength(9);
    expect(pieces('approval-pill')).toHaveLength(5);
    // Each state, and the live answer's four steps (W1-14).
    expect(pieces('step-marker')).toHaveLength(9);
    expect(pieces('list-dot')).toHaveLength(6);
    expect(pieces('list-progress')).toHaveLength(1);
    expect(pieces('new-pill')).toHaveLength(1);
    expect(pieces('attention-dot')).toHaveLength(1);
    expect(pieces('attention-count')).toHaveLength(2);
    // Three sizes, and the live answer's finished header (W1-14).
    expect(pieces('done-tick')).toHaveLength(4);
  });

  it('shows every run card in every state, and the runs tray', async () => {
    await render();
    expect(slots('plan-card')).toHaveLength(3);
    // Running, waiting, done, one step, stopped, failed; one in the result card, and the live answer's.
    expect(slots('run-steps')).toHaveLength(8);
    const approvals = ([...slots('agent-card')] as HTMLElement[]).filter((el) =>
      el.hasAttribute('data-kind'),
    );
    expect(approvals.map((el) => `${el.dataset.kind}:${el.dataset.status}`)).toEqual([
      'write:pending',
      'write:pending',
      'write:saving',
      'write:error',
      'execute:pending',
      'execute:pending',
      'execute:saving',
      'execute:pending',
    ]);
    expect(slots('question-card')).toHaveLength(3);
    expect(slots('next-moves')).toHaveLength(1);
    expect(slots('question-answered')).toHaveLength(2);
    expect(slots('done-line')).toHaveLength(2);
    expect(slots('approval-skipped')).toHaveLength(1);
    expect([...slots('result-card')].map((el) => (el as HTMLElement).dataset.state)).toEqual([
      'done',
      'needsClick',
    ]);
    expect(slots('denial-card')).toHaveLength(3);
    expect(slots('error-card')).toHaveLength(2);
    expect(container.querySelectorAll('[data-action="runs.toggleTray"]')).toHaveLength(3);
  });

  it('gives every control on it a data-action id', async () => {
    await render();
    const controls = [
      ...container.querySelectorAll<HTMLElement>('button, a, input, textarea, [role="button"]'),
    ];
    expect(controls.length).toBeGreaterThan(40);
    for (const el of controls) expect(el.dataset.action, el.outerHTML.slice(0, 80)).toBeTruthy();
  });
});
