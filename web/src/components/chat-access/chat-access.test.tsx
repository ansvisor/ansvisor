import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatAccess, RoleMember } from '@/lib/actions/chat-access';
import type { CapabilityArea, PlanCard } from '@/lib/chat/access';
import type { ToolCatalogEntry } from '@/lib/chat/registry/tools';

/** Roles & access, Your access, the plan card and "What Chat can do" (CHAT-20 §4a, §4b, §7a, §8). */

const getChatAccess = vi.fn();
const listRoleMembers = vi.fn();
vi.mock('@/lib/actions/chat-access', () => ({
  getChatAccess: () => getChatAccess(),
  listRoleMembers: () => listRoleMembers(),
}));
vi.mock('@/lib/actions/team', () => ({ updateMemberRole: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ guard: (fn: unknown) => fn }),
}));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: { percentUsed: 18 }, refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RolesAccessSection } = await import('./roles-access-section');
const { YourAccessCard } = await import('./your-access-card');
const { YourPlanCard } = await import('./plan-card');
const { CapabilitiesView } = await import('./capabilities-view');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getChatAccess.mockReset();
  listRoleMembers.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        now={new Date('2026-10-29T12:00:00Z')}
      >
        {node}
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';

const starter: PlanCard = {
  planId: 'starter',
  planName: 'Starter',
  priceMonthly: 49,
  isTrial: false,
  chips: [
    { key: 'platforms', count: 2, locked: null },
    { key: 'fullAuto', locked: 'growth' },
  ],
  next: {
    planId: 'growth',
    planName: 'Growth',
    priceMonthly: 249,
    priceDiff: 200,
    afterTrial: false,
    benefits: [
      { key: 'morePlatforms', count: 6 },
      { key: 'aiLimit', times: 5 },
    ],
  },
};

const access = (over: Partial<ChatAccess> = {}): ChatAccess => ({
  role: 'manager',
  plan: starter,
  yourAccess: [
    { key: 'read', class: 'read', value: 'yes' },
    {
      key: 'execute',
      class: 'execute',
      value: 'after_click_except',
      off: ['publishing', 'feeds'],
    },
    { key: 'settings', class: 'write', value: 'ask_admin' },
  ],
  switches: {
    managerExecuteOff: ['publishing'],
    fullAutoForMembers: true,
    fullAutoLocked: 'growth',
    setBy: 'Ayşe',
  },
  toolLocks: {},
  ...over,
});

const members: RoleMember[] = [
  {
    userId: 'u1',
    name: 'Sam Lee',
    email: 'sam@ansvisor.example',
    role: 'admin',
    lastActiveAt: '2026-10-29T11:48:00Z',
    isYou: false,
  },
  { userId: 'u2', name: 'alex', email: null, role: 'manager', lastActiveAt: null, isYou: true },
];

describe('YourPlanCard', () => {
  it('shows the plan, what it locks, the AI limit used, and what Growth adds for an Admin', async () => {
    await render(<YourPlanCard plan={starter} isAdmin />);
    expect(text()).toContain('Starter$49/mo');
    expect(text()).toContain('2 AI platforms');
    expect(
      container.querySelector('[title="Needs Growth · you\'re on Starter"]')?.textContent,
    ).toContain('Full auto');
    expect(text()).toContain('18% used');
    expect(text()).toContain("With Growth you'd also get");
    expect(text()).toContain('See your brand in 6 more AI platforms');
    expect(text()).toContain('5× the monthly AI limit');
    expect(text()).toContain('+$200/mo');
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).not.toBeNull();
    expect(text()).toContain('Upgrade');
  });

  it('leaves Upgrade to Admins, and the next plan off Enterprise', async () => {
    await render(<YourPlanCard plan={starter} isAdmin={false} />);
    expect(text()).not.toContain('Upgrade');
    await render(
      <YourPlanCard
        plan={{
          ...starter,
          planId: 'enterprise',
          planName: 'Enterprise',
          priceMonthly: null,
          next: null,
        }}
        isAdmin
      />,
    );
    expect(text()).toContain('EnterpriseCustom contract');
    expect(text()).not.toContain("you'd also get");
    expect(text()).not.toContain('Upgrade');
  });
});

describe('YourAccessCard', () => {
  it("says the person's role and what Chat may do as them", async () => {
    await render(<YourAccessCard access={access()} />);
    expect(text()).toContain('Your accessManager');
    expect(text()).toContain('All brands');
    expect(text()).toContain('After your click, except publishing, feed pushes');
    expect(text()).toContain('Ask your Admin');
    expect(container.querySelector('a[href="/dashboard/settings/roles-access"]')?.textContent).toBe(
      'See what each role can do',
    );
    expect(container.querySelector('a[href="/dashboard/chat/capabilities"]')).not.toBeNull();
  });
});

describe('RolesAccessSection', () => {
  it("is read-only for a Manager: no e-mails, no role picker, the switches' state", async () => {
    getChatAccess.mockResolvedValue(access());
    listRoleMembers.mockResolvedValue(members.map((m) => ({ ...m, email: null })));
    await render(<RolesAccessSection />);
    expect(text()).toContain("You're a Manager · read-only here");
    expect(text()).not.toContain('@');
    expect(container.querySelector('[aria-label="Role"]')).toBeNull();
    expect(text()).toContain('WRITE with approval · EXECUTE after click');
    expect(text()).toContain('12 minutes ago');
    expect(text()).toContain('Not yet');
    expect(text()).toContain('What each role can do');
    expect(text()).toContain('Off for publishing');
    expect(text()).toContain('Needs Growth');
    expect(text()).toContain('Set by Ayşe');
  });

  it('gives an Admin the e-mails and a role picker for everyone but themselves', async () => {
    getChatAccess.mockResolvedValue(access({ role: 'admin' }));
    listRoleMembers.mockResolvedValue(members);
    await render(<RolesAccessSection />);
    expect(text()).not.toContain('read-only here');
    expect(text()).toContain('sam@ansvisor.example');
    expect(container.querySelectorAll('[aria-label="Role"]')).toHaveLength(1);
  });

  it('says so when it cannot be read', async () => {
    getChatAccess.mockRejectedValue(new Error('down'));
    listRoleMembers.mockResolvedValue([]);
    await render(<RolesAccessSection />);
    expect(text()).toContain("Couldn't load Roles & access");
  });
});

describe('CapabilitiesView', () => {
  const entry = (
    key: string,
    cls: ToolCatalogEntry['class'],
    over: Partial<ToolCatalogEntry> = {},
  ) =>
    ({
      key,
      area: 'prompts',
      class: cls,
      defaultPolicy: cls === 'read' ? 'on' : 'ask_full_auto',
      maxPolicy: cls === 'read' ? 'on' : 'always',
      flags: { alwaysCard: false, costCard: false, adminMayTurnOff: false },
      minRole: 'analyst',
      excludeRoles: [],
      planGate: null,
      costClass: 'C1',
      route: null,
      ...over,
    }) as ToolCatalogEntry;
  const areas: CapabilityArea[] = [
    {
      area: 'prompts',
      read: [entry('trackedPrompts', 'read')],
      write: [entry('dismissSuggestion', 'write', { excludeRoles: ['agency_partner'] })],
      execute: [],
      writers: ['admin', 'manager', 'analyst'],
    },
    {
      area: 'citations',
      read: [entry('citations', 'read', { area: 'citations' })],
      write: [],
      execute: [],
      writers: [],
    },
  ];

  it('lists each area with its tools, who may change it, and what the plan locks', async () => {
    await render(
      <CapabilitiesView access={access({ toolLocks: { citations: 'growth' } })} areas={areas} />,
    );
    expect(text()).toContain('What Chat can do2 areas');
    expect(text()).toContain('Read tracked prompts');
    expect(text()).toContain('Dismiss prompt suggestions');
    expect(text()).toContain('Admin · Manager · Analyst');
    expect(text()).toContain('Read: all roles');
    expect(text()).toContain('Read citationsNeeds Growth');
  });

  it('narrows to areas with changes, and to a search', async () => {
    await render(<CapabilitiesView access={access()} areas={areas} />);
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
    await act(async () => button('Has WRITE').click());
    expect(text()).not.toContain('Read citations');
    await act(async () => button('All').click());
    const input = container.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'citat');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(text()).toContain('Read citations');
    expect(text()).not.toContain('Read tracked prompts');
  });
});
