import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { AuditResult, AuditSignal } from '@/lib/actions/audits';

/**
 * A Site Audit report (step 9's detail pages): what Chat's side panel sees
 * of it, from the audit the page already read.
 */

const ID = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }) }));
const getAudit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/audits', () => ({
  getAudit,
  runAudit: vi.fn(),
  deleteAudit: vi.fn(),
  sendAuditToActionCenter: vi.fn(),
}));
vi.mock('@/components/audit/audit-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuditReport: () => null,
}));
vi.mock('@/components/audit/use-recent-audit', () => ({
  useRecentAudit: () => ({ askOne: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({
    guard: (fn: () => void) => fn,
    isLocked: false,
    openUpgrade: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(), success: vi.fn() }),
}));
const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: AuditDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const signal = (key: string, category: string, status: AuditSignal['status']): AuditSignal => ({
  key,
  category,
  status,
  score: status === 'pass' ? 1 : 0,
  evidence: {},
  label: key.replace(/-/g, ' '),
  what: null,
  why: null,
  howToFix: null,
  impactTier: 'standard',
});

const audit: AuditResult = {
  id: ID,
  brandId: 'b1',
  url: 'https://northwind.example/pricing',
  finalUrl: null,
  status: 'completed',
  totalScore: 0.63,
  categoryScores: {},
  signalsEvaluated: 4,
  signalsTotal: 4,
  rubricVersion: '1',
  error: null,
  createdAt: '2026-10-17T09:00:00.000Z',
  completedAt: '2026-10-17T09:01:00.000Z',
  // Content's before Structure's in the list: the report shows Structure first.
  signals: [
    signal('author-byline', 'eeat', 'warn'),
    signal('readability', 'content', 'pass'),
    signal('faq-schema', 'structure', 'fail'),
    signal('answer-first', 'content', 'fail'),
  ],
  recommendations: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatPage.mockClear();
  getAudit.mockReset().mockResolvedValue(audit);
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
        <AuditDetailPage />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the report open by its id, named by its page, and the checks it fails or warns on, in its order', async () => {
    await render();
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Site Audit report',
      view: {
        open: { ref: ID, label: 'https://northwind.example/pricing' },
        rows: [
          { ref: 'faq-schema', label: 'faq schema (failed)' },
          { ref: 'answer-first', label: 'answer first (failed)' },
          { ref: 'author-byline', label: 'author byline (warning)' },
        ],
      },
    });
  });

  it('sends no checks while the audit runs', async () => {
    getAudit.mockResolvedValue({ ...audit, status: 'running', signals: [] });
    await render();
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Site Audit report',
      view: { open: { ref: ID, label: 'https://northwind.example/pricing' } },
    });
  });

  it('says nothing while it reads', async () => {
    getAudit.mockReturnValue(new Promise(() => {}));
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});
