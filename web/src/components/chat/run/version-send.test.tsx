import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A version card's Send to CMS (CHAT-25 §6, W4-12b): the page read as the
 * Library reads it for its own Send, in the draft's own brand, then the
 * Library's Send dialog; a page that can't be read closes it, said by the
 * card.
 */

const DRAFT = '55555555-5555-4555-8555-555555555555';
const BRAND = '11111111-1111-4111-8111-111111111111';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => nav }));
const reads = vi.hoisted(() => ({ getContentDraft: vi.fn(), readCmsSources: vi.fn() }));
vi.mock('@/lib/actions/content-drafts', () => ({ getContentDraft: reads.getContentDraft }));
vi.mock('@/lib/content/cms-sources', () => ({ readCmsSources: reads.readCmsSources }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (state: unknown) => unknown) =>
    pick({ brands: [{ id: BRAND, name: 'Acme', language: 'en' }] }),
}));
const dialog = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@/components/content/send-to-cms-dialog', () => ({
  SendDialog: (props: Record<string, unknown>) => {
    dialog.props = props;
    return <div data-slot="send-dialog" />;
  },
}));

const { VersionSendDialog } = await import('./version-send');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SOURCE = {
  draftId: DRAFT,
  title: 'Pricing FAQ',
  html: '<h1>Pricing FAQ</h1>',
  sourceUrl: null,
  author: null,
  reviewer: null,
  teamByline: 'The Acme team',
  byline: null,
};

let container: HTMLDivElement;
let root: Root;
const onFailed = vi.fn();
const onClose = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <VersionSendDialog
        draftId={DRAFT}
        href={`/dashboard/content/editor/${DRAFT}`}
        onFailed={onFailed}
        onClose={onClose}
      />,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  dialog.props = null;
  onFailed.mockClear();
  onClose.mockClear();
  nav.push.mockClear();
  reads.getContentDraft.mockReset().mockResolvedValue({ id: DRAFT, brandId: BRAND });
  reads.readCmsSources.mockReset().mockResolvedValue(new Map([[DRAFT, SOURCE]]));
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('VersionSendDialog', () => {
  it('reads the page in its own brand, as the Library does, and opens the Send dialog', async () => {
    await render();
    expect(reads.readCmsSources).toHaveBeenCalledWith({
      brandId: BRAND,
      draftIds: [DRAFT],
      brandName: 'Acme',
      brandLanguage: 'en',
    });
    expect(dialog.props).toMatchObject({
      draftId: DRAFT,
      brandId: BRAND,
      title: 'Pricing FAQ',
      teamByline: 'The Acme team',
    });
    // Placeholders are filled in the editor.
    (dialog.props!.onFillNow as () => void)();
    expect(nav.push).toHaveBeenCalledWith(`/dashboard/content/editor/${DRAFT}`);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('closes, said by the card, for a page that is gone or can’t be read', async () => {
    reads.getContentDraft.mockResolvedValueOnce(null);
    await render();
    expect(dialog.props).toBeNull();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.readCmsSources.mockRejectedValueOnce(new Error('down'));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(dialog.props).toBeNull();
    expect(onFailed).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
