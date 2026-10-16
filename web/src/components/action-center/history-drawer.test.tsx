import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionHistoryItem } from '@/lib/action-center/history';
import messages from '../../../messages/en.json';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { HistoryDrawer } from './history-drawer';

const item = (signalCount: number): ActionHistoryItem => ({
  id: 'action-id',
  actionNo: 1,
  kind: 'recover_visibility',
  type: 'recover',
  impact: 'high',
  status: 'completed',
  outcome: 'pending_measurement',
  payload: {},
  kpiKeys: [],
  sources: [],
  triggerSignals: Array.from({ length: signalCount }, (_, i) => ({
    signalId: `signal-${i}`,
    kind: 'visibility_drop',
    detectedAt: '2026-01-01T00:00:00.000Z',
  })),
  affected: [],
  results: [],
  positionOutcome: null,
  tasks: [],
  assignee: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-05T00:00:00.000Z',
  timeToCloseDays: 4,
});

async function renderDrawer(signalCount: number) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <HistoryDrawer item={item(signalCount)} onOpenChange={() => {}} />
      </NextIntlClientProvider>,
    );
  });
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('HistoryDrawer', () => {
  it.each([
    [1, 'Consolidated from 1 signal'],
    [3, 'Consolidated from 3 signals'],
  ])('counts %i trigger signal(s) in the right grammatical number', async (count, text) => {
    const root = await renderDrawer(count);
    const line = Array.from(document.body.querySelectorAll('p')).find((p) =>
      p.textContent?.startsWith('Consolidated from'),
    );
    expect(line?.textContent).toBe(text);
    await act(async () => root.unmount());
  });
});
