import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/**
 * The Chat pieces preview (Chat P0, D1): there only with the new Chat on for
 * the workspace, and every piece in every state on it.
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
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
    // 5 states in 3 sizes, and the 5 still ones of the Agents list.
    const avatars = [...slots('agent-avatar')] as HTMLElement[];
    const states = new Set(['idle', 'working', 'waiting', 'done', 'failed']);
    const live = avatars.filter((el) => el.dataset.tone === 'live');
    const muted = avatars.filter((el) => el.dataset.tone === 'muted');
    expect(live).toHaveLength(15);
    expect(new Set(live.map((el) => el.dataset.state))).toEqual(states);
    expect(muted).toHaveLength(5);
    expect(new Set(muted.map((el) => el.dataset.state))).toEqual(states);
    expect(slots('status-pill')).toHaveLength(9);
    expect(slots('approval-pill')).toHaveLength(5);
    expect(slots('step-marker')).toHaveLength(5);
    expect(slots('list-dot')).toHaveLength(6);
    expect(slots('list-progress')).toHaveLength(1);
    expect(slots('new-pill')).toHaveLength(1);
    expect(slots('attention-dot')).toHaveLength(1);
    expect(slots('attention-count')).toHaveLength(2);
    expect(slots('done-tick')).toHaveLength(3);
  });

  it('gives every control on it a data-action id', async () => {
    await render();
    const controls = [...container.querySelectorAll<HTMLElement>('button, a, [role="button"]')];
    expect(controls.map((el) => el.dataset.action)).toEqual(['chatMenu.dotLegend']);
  });
});
