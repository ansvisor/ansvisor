import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';
import type { ActionItem } from '@/lib/actions/action-center';
import {
  buildGettingStarted,
  type GettingStartedFacts,
  type GettingStartedStatus,
  type GettingStartedStep,
} from '@/lib/getting-started/steps';

/**
 * The actions list's Export CSV (AC-005): it reads what each listed action's
 * Affected tab names, then downloads the list with it, as UTF-8 Excel reads.
 * And Getting started (AC-ALT2 §4): its steps open the page while a brand
 * runs it, and the page is unchanged for a brand that doesn't.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Technology',
  region: 'US',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const action: ActionItem = {
  id: 'a1',
  actionNo: 35,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-16T09:05:31Z',
  updatedAt: '2026-10-16T09:05:31Z',
  taskTotal: 8,
  taskCompleted: 0,
  signalCount: 3,
  priorityScore: 90,
  priorityLevel: 'critical',
  priorityReason: null,
};

const { getActions, getActionsAffected, getGettingStarted, saveBlob, toast } = vi.hoisted(() => ({
  getActions: vi.fn(),
  getActionsAffected: vi.fn(),
  getGettingStarted: vi.fn(),
  saveBlob: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { getActiveBrand: () => Brand }) => unknown) =>
    selector({ getActiveBrand: () => brand }),
}));
vi.mock('@/lib/actions/action-center', () => ({ getActions, getActionsAffected }));
vi.mock('@/lib/actions/getting-started', () => ({ getGettingStarted }));
vi.mock('@/lib/actions/team', () => ({ listMembers: vi.fn(async () => []) }));
vi.mock('@/lib/download', () => ({ saveBlob }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/action-center/action-center-tabs', () => ({ ActionCenterTabs: () => null }));
vi.mock('@/components/action-center/action-table', () => ({ ActionTable: () => null }));
vi.mock('@/components/action-center/action-drawer', () => ({ ActionDrawer: () => null }));
vi.mock('@/components/getting-started/getting-started-table', () => ({
  GettingStartedTable: ({
    steps,
    showNote,
    onSelect,
  }: {
    steps: GettingStartedStep[];
    showNote: boolean;
    onSelect: (step: GettingStartedStep) => void;
  }) => (
    <div data-testid="steps">
      <span data-testid="steps-summary">{`${steps.length} steps${showNote ? ', with the note' : ''}`}</span>
      {steps.map((step) => (
        <button key={step.key} data-step={step.key} onClick={() => onSelect(step)}>
          {step.key}
        </button>
      ))}
    </div>
  ),
  readyWhenKey: () => 'setup',
}));
vi.mock('@/components/getting-started/step-card', () => ({
  GettingStartedStepCard: ({ step }: { step: GettingStartedStep }) => (
    <div data-testid="card">{step.key}</div>
  ),
}));

const { default: ActionCenterActionsPage } = await import('./page');

let container: HTMLDivElement;
let root: Root;

const exportButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'exportCsv')!;

async function render() {
  await act(async () => root.render(<ActionCenterActionsPage />));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  getActions.mockReset().mockResolvedValue([action]);
  getGettingStarted.mockReset().mockResolvedValue(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  getActionsAffected.mockReset();
  saveBlob.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the actions list Export CSV', () => {
  it("adds each action's affected count and names, in a file Excel reads as UTF-8", async () => {
    getActionsAffected.mockResolvedValue({
      a1: { count: 3, items: ['Best coffee subscription?', 'Coffee delivery'] },
    });
    await render();
    await act(async () => exportButton().click());

    expect(getActionsAffected).toHaveBeenCalledWith('brand-id', ['a1']);
    const [blob, fileName] = saveBlob.mock.calls[0] as [Blob, string];
    expect(fileName).toMatch(/^ansvisor_acme_actions_\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, row] = new TextDecoder().decode(bytes.slice(3)).split('\n');
    expect(header).toContain(',signal_count,affected_count,affected_items,created');
    expect(row).toContain(',3,3,Best coffee subscription?; Coffee delivery,');
    expect(exportButton().disabled).toBe(false);
  });

  it('says so when the affected items cannot be read, and downloads nothing', async () => {
    getActionsAffected.mockRejectedValue(new Error('offline'));
    await render();
    await act(async () => exportButton().click());

    expect(toast.error).toHaveBeenCalledWith('export.exportFailed');
    expect(saveBlob).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
  });

  it("holds the button while it reads, and drops the file once the brand's view is gone", async () => {
    let answer: (value: unknown) => void = () => {};
    getActionsAffected.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await act(async () => exportButton().click());
    expect(exportButton().disabled).toBe(true);

    act(() => root.unmount());
    await act(async () => answer({}));
    expect(saveBlob).not.toHaveBeenCalled();
    // Mounted again for afterEach's unmount.
    root = createRoot(container);
  });
});

const started = (over: Partial<GettingStartedFacts> = {}): GettingStartedStatus =>
  buildGettingStarted({
    startedAt: '2026-10-20T10:00:00Z',
    dismissedAt: null,
    records: {},
    recordedAt: {},
    kpiSetupAt: null,
    competitors: 1,
    topicPrompts: [],
    gsc: false,
    ga: false,
    firstAnswer: false,
    firstVisit: false,
    dataSuggestions: 0,
    dataTracked: 0,
    contentSuggestions: 0,
    contentPicked: 0,
    contentCreated: 0,
    audits: 0,
    ...over,
  });

const steps = () => container.querySelector('[data-testid="steps"]');
const text = () => container.textContent ?? '';

describe('Getting started in the actions list', () => {
  it("leaves the page as it is for a brand that doesn't run it", async () => {
    getGettingStarted.mockResolvedValue(started({ startedAt: null }));
    await render();

    expect(steps()).toBeNull();
    expect(text()).not.toContain('card.title');
    expect(text()).toContain('cards.priority');
    expect(exportButton()).toBeDefined();
  });

  it('opens on its steps for a new brand, the ranking cards waiting for the first signals', async () => {
    getActions.mockResolvedValue([]);
    getGettingStarted.mockResolvedValue(started());
    await render();

    expect(container.querySelector('[data-testid="steps-summary"]')?.textContent).toBe(
      '17 steps, with the note',
    );
    expect(text()).toContain('card.title');
    expect(text().match(/firstSignals/g)).toHaveLength(3);
    // Getting started takes Highest Priority's place; the filters are for actions.
    expect(text()).not.toContain('cards.priority');
    expect(exportButton()).toBeUndefined();
  });

  it("opens a step's card, and says when a step still waiting for data opens", async () => {
    getGettingStarted.mockResolvedValue(started());
    await render();
    const card = () => container.querySelector('[data-testid="card"]');
    expect(card()).toBeNull();

    const stepButton = (key: string) =>
      container.querySelector<HTMLButtonElement>(`[data-step="${key}"]`)!;
    await act(async () => stepButton('competitors').click());
    expect(card()?.textContent).toBe('competitors');

    // Mentions waits for the first answers.
    await act(async () => stepButton('mentions').click());
    expect(toast).toHaveBeenCalledWith('opensWhenReady');
    expect(card()?.textContent).toBe('competitors');
  });

  // gkhngyk on #1235: Create action, a signal and the history drawer link to
  // ?action=<id>; on a new brand the drawer opened over the steps.
  it('lists the actions for a link to one action, or to a filtered list', async () => {
    for (const search of ['?action=a1', '?status=new', '?q=coffee']) {
      window.history.replaceState(null, '', `/${search}`);
      getGettingStarted.mockResolvedValue(started());
      await render();
      expect(steps(), search).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('keeps a category the URL names, and lists the actions', async () => {
    window.history.replaceState(null, '', '/?category=all');
    getGettingStarted.mockResolvedValue(started());
    await render();

    expect(steps()).toBeNull();
    expect(text()).toContain('card.title');
    expect(exportButton()).toBeDefined();
  });

  it('reads as before when Getting started cannot be read', async () => {
    getGettingStarted.mockRejectedValue(new Error('offline'));
    await render();

    expect(steps()).toBeNull();
    expect(text()).toContain('cards.priority');
  });
});
