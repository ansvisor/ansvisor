// @vitest-environment node
import { Children, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Agent Center's pages (CHAT-21 §B, §C, §D), out of Chat at /dashboard/agents:
 * there only with the new Chat on for the workspace (CHAT_AGENTIC), as
 * Chat's own pages, the detail and Edit only for an agent's id the person
 * can see, New agent with its setup; otherwise not found.
 */

const access = vi.hoisted(() => ({ open: true }));
vi.mock('../chat/_chat-page-access', () => ({ chatPageOpen: async () => access.open }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/components/chat/agents/agents-list', () => ({ AgentsList: () => null }));
vi.mock('@/components/chat/agents/agent-detail', () => ({ AgentDetail: () => null }));
vi.mock('@/components/chat/agents/agent-form', () => ({ AgentForm: () => null }));
const form = vi.hoisted(() => ({
  setup: { role: 'manager' } as unknown,
  agent: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    version: 3,
    updatedAt: '2026-10-29T10:00:00.000Z',
  } as unknown,
}));
vi.mock('@/lib/chat/agent-form-setup', () => ({
  readAgentFormSetup: vi.fn(async () => form.setup),
  readAgentEdit: vi.fn(async () =>
    form.setup && form.agent ? { setup: form.setup, agent: form.agent } : null,
  ),
}));

const { default: AgentsPage } = await import('./page');
const { default: AgentPage } = await import('./[id]/page');
const { default: NewAgentPage } = await import('./new/page');
const { default: EditAgentPage } = await import('./[id]/edit/page');
const { default: AgentCenterLayout } = await import('./layout');
const { AgentsSeen } = await import('@/components/chat/agents/agents-seen');
const { AgentForm } = await import('@/components/chat/agents/agent-form');
const { AgentsList } = await import('@/components/chat/agents/agents-list');
const { AgentDetail } = await import('@/components/chat/agents/agent-detail');

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const search = (skill?: string) => ({ searchParams: Promise.resolve(skill ? { skill } : {}) });

beforeEach(() => {
  access.open = true;
  form.setup = { role: 'manager' };
  form.agent = { id: ID, version: 3, updatedAt: '2026-10-29T10:00:00.000Z' };
  notFound.mockClear();
});

describe('Agent Center pages', () => {
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

describe('Agent Center layout', () => {
  it('marks Agent Center seen on every one of its pages, so the chat menu’s New goes', () => {
    const tree = AgentCenterLayout({ children: <p>page</p> }) as ReactElement<{
      children: ReactElement[];
    }>;
    const parts = Children.toArray(tree.props.children) as ReactElement[];
    expect(parts.map((part) => part.type)).toEqual([AgentsSeen, 'p']);
  });
});

describe('New agent and Edit (W2-15)', () => {
  it('are not found while the new Chat is off for the workspace', async () => {
    access.open = false;
    await expect(NewAgentPage(search())).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(EditAgentPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it('show the form with its setup, from a skill when one is named', async () => {
    const page = (await NewAgentPage(search('winback'))) as {
      type: unknown;
      props: { setup: unknown; initialSkill: string | null };
    };
    expect(isValidElement(page) && page.type).toBe(AgentForm);
    expect(page.props).toMatchObject({ setup: form.setup, initialSkill: 'winback' });
    const plain = (await NewAgentPage(search())) as { props: { initialSkill: string | null } };
    expect(plain.props.initialSkill).toBeNull();
  });

  it('show Edit filled with the agent, keyed by its version and last save', async () => {
    const page = (await EditAgentPage(params(ID))) as {
      type: unknown;
      key: string;
      props: { agent: unknown };
    };
    expect(isValidElement(page) && page.type).toBe(AgentForm);
    expect(page.props.agent).toBe(form.agent);
    expect(page.key).toBe(`${ID}:3:2026-10-29T10:00:00.000Z`);
  });

  it('opens Edit fresh after a save that made no new version, so Reload clears a conflict', async () => {
    // Someone else renamed or paused it: the same version, a later updatedAt.
    const before = (await EditAgentPage(params(ID))) as { key: string };
    form.agent = { id: ID, version: 3, updatedAt: '2026-10-29T10:05:00.000Z' };
    const after = (await EditAgentPage(params(ID))) as { key: string };
    expect(after.key).not.toBe(before.key);
  });

  it('are not found without a setup, for an id that isn’t an agent’s, or an agent the person can’t see', async () => {
    form.setup = null;
    await expect(NewAgentPage(search())).rejects.toThrow('NEXT_NOT_FOUND');
    form.setup = { role: 'manager' };
    await expect(EditAgentPage(params('new'))).rejects.toThrow('NEXT_NOT_FOUND');
    form.agent = null;
    await expect(EditAgentPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
