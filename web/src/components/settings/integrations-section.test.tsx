import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Settings › Integrations, a connected Search Console on a read-only
 * workspace (plan not active): no brand is mapped to a property by itself,
 * and picking one opens the upgrade dialog instead of saving it. On an
 * active plan both save.
 */

const integrations = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  disconnectIntegration: vi.fn(),
  getGscProperties: vi.fn(),
  getGscBrandMappings: vi.fn(),
  setBrandGscProperty: vi.fn(),
  getGaProperties: vi.fn(),
  getGaBrandMappings: vi.fn(),
  setBrandGaProperty: vi.fn(),
}));
vi.mock('@/lib/actions/integrations', () => integrations);
vi.mock('@/hooks/use-integration-connect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('./catalog-sources-card', () => ({ CatalogSourcesCard: () => null }));
vi.mock('./webflow-card', () => ({ WebflowCard: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { IntegrationsSection } = await import('./integrations-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  integrations.getIntegrationStatus.mockImplementation(async (provider: string) => ({
    configured: provider === 'google-search-console',
    status: provider === 'google-search-console' ? 'connected' : 'not_configured',
  }));
  integrations.getGscProperties.mockResolvedValue([
    { siteUrl: 'https://acme.com/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://other.example/', permissionLevel: 'siteOwner' },
  ]);
  // Acme matches one property by its domain; Beta matches none.
  integrations.getGscBrandMappings.mockResolvedValue([
    { brandId: 'b1', brandName: 'Acme', gscProperty: null, domains: ['acme.com'] },
    { brandId: 'b2', brandName: 'Beta', gscProperty: null, domains: ['beta.test'] },
  ]);
  integrations.setBrandGscProperty.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <IntegrationsSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

/** Picks a property for the nth brand row's picker. */
async function pick(row: number, label: string) {
  await act(async () => {
    container.querySelectorAll<HTMLElement>('[role="combobox"]')[row].click();
  });
  // A picker with a value keeps its list mounted: the one just opened is the last.
  const option = [
    ...[...document.querySelectorAll('[role="listbox"]')]
      .at(-1)!
      .querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((o) => o.textContent === label)!;
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
  await act(async () => option.click());
}

describe('IntegrationsSection property mapping', () => {
  it('maps nothing on a read-only workspace: no auto-match, and a pick opens the upgrade dialog', async () => {
    await render(true);
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(integrations.setBrandGscProperty).not.toHaveBeenCalled();

    await pick(1, 'https://other.example/');
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Choosing a property needs a plan');
    expect(integrations.setBrandGscProperty).not.toHaveBeenCalled();
  });

  it('maps a matching brand by itself and saves a pick on an active plan', async () => {
    await render(false);
    expect(integrations.setBrandGscProperty).toHaveBeenCalledExactlyOnceWith(
      'b1',
      'https://acme.com/',
    );

    await pick(1, 'https://other.example/');
    expect(integrations.setBrandGscProperty).toHaveBeenLastCalledWith(
      'b2',
      'https://other.example/',
    );
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
