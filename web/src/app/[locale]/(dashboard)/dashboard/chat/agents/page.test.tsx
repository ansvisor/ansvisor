// @vitest-environment node
import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat › Agents' pages (CHAT-21 §B, §C): there only with the new Chat on for
 * the workspace (CHAT_AGENTIC), and the detail only for an agent's id;
 * otherwise not found.
 */

const access = vi.hoisted(() => ({ open: true }));
vi.mock('../_chat-page-access', () => ({ chatPageOpen: async () => access.open }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/components/chat/agents/agents-list', () => ({ AgentsList: () => null }));
vi.mock('@/components/chat/agents/agent-detail', () => ({ AgentDetail: () => null }));

const { default: AgentsPage } = await import('./page');
const { default: AgentPage } = await import('./[id]/page');
const { AgentsList } = await import('@/components/chat/agents/agents-list');
const { AgentDetail } = await import('@/components/chat/agents/agent-detail');

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  access.open = true;
  notFound.mockClear();
});

describe('Chat › Agents pages', () => {
  it('are not found while the new Chat is off for the workspace', async () => {
    access.open = false;
    await expect(AgentsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(AgentPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it('show the list, and the detail for an agent id', async () => {
    const list = await AgentsPage();
    expect(isValidElement(list) && list.type).toBe(AgentsList);
    const one = await AgentPage(params(ID));
    expect(isValidElement(one) && one.type).toBe(AgentDetail);
    expect((one as { props: { id: string } }).props.id).toBe(ID);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("are not found for an address that isn't an agent's id", async () => {
    await expect(AgentPage(params('new'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
