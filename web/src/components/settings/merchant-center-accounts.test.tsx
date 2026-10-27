import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

const listSignInAccounts = vi.fn();
const connectSignInAccount = vi.fn();
vi.mock('@/lib/catalog-client', () => ({
  listSignInAccounts: (...args: unknown[]) => listSignInAccounts(...args),
  connectSignInAccount: (...args: unknown[]) => connectSignInAccount(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
// The picker's popup isn't what's tested: a plain select stands in for it.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    items,
  }: {
    value: string | null;
    onValueChange: (v: string | null) => void;
    items: { value: string; label: string }[];
  }) => (
    <select
      aria-label="Choose an account"
      value={value ?? ''}
      onChange={(e) => onValueChange(e.target.value || null)}
    >
      <option value="" />
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const { MerchantCenterAccounts, accountLabel } = await import('./merchant-center-accounts');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Google Merchant Center (#1270): a brand picks its account. */

let container: HTMLDivElement;
let root: Root;
const onConnected = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MerchantCenterAccounts onConnected={onConnected} />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
async function pick(value: string) {
  const select = container.querySelector('select')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  role.canManage = true;
  listSignInAccounts.mockReset().mockResolvedValue({
    ok: true,
    accounts: [
      { id: '123', name: 'Acme Outdoor' },
      { id: '456', name: null },
    ],
  });
  connectSignInAccount.mockReset().mockResolvedValue({ ok: true });
  onConnected.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('accountLabel', () => {
  it('names an account by its name and id, or its id', () => {
    expect(accountLabel({ id: '123', name: 'Acme Outdoor' })).toBe('Acme Outdoor (123)');
    expect(accountLabel({ id: '456', name: null })).toBe('456');
  });
});

describe('MerchantCenterAccounts', () => {
  it("lists the accounts the workspace's Google sign-in opens, and adds the picked one to the brand", async () => {
    await render();
    expect(listSignInAccounts).toHaveBeenCalledWith('b1', 'merchant_center');
    const text = container.textContent ?? '';
    expect(text).toContain('Merchant Center account for Acme');
    expect([...container.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '',
      'Acme Outdoor (123)',
      '456',
    ]);
    expect(button('Add account')!.disabled).toBe(true);

    await pick('123');
    await act(async () => button('Add account')!.click());
    expect(connectSignInAccount).toHaveBeenCalledWith('b1', 'merchant_center', '123');
    expect(toast.success).toHaveBeenCalledWith(
      'Acme Outdoor (123) added. Its products are being read now.',
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("says why it couldn't add the account, in plain words", async () => {
    connectSignInAccount.mockResolvedValue({ ok: false, code: 'duplicate', message: null });
    await render();
    await pick('123');
    await act(async () => button('Add account')!.click());
    expect(toast.error).toHaveBeenCalledWith('This account is added to the brand already.');
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('says when the sign-in no longer opens Merchant Center, or opens no account', async () => {
    listSignInAccounts.mockResolvedValue({ ok: false, code: 'not_connected' });
    await render();
    expect(container.textContent).toContain(
      'The Google sign-in no longer opens Merchant Center. Disconnect it and connect again.',
    );

    listSignInAccounts.mockResolvedValue({ ok: true, accounts: [] });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain(
      "This Google sign-in doesn't open any Merchant Center account.",
    );
  });

  it("asks nothing of members who aren't admins or managers", async () => {
    role.canManage = false;
    await render();
    expect(listSignInAccounts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Admins and managers can add and sync sources.');
  });
});
