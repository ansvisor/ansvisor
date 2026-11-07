import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ProductPagesContext, groupSizeOf, productPagesOf } from './product-pages-context';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const setProductGroupSize = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/action-center', () => ({ setProductGroupSize }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();

const SHOP = 'https://shop.example';
const product = (i: number, over: Record<string, unknown> = {}) => ({
  url: `${SHOP}/products/p${i}`,
  title: `Product ${i}`,
  prompts: 3,
  aiVisits: 12,
  orders: 2,
  revenue: 180.5,
  currency: 'USD',
  ...over,
});
const payload = { groupSize: 3, products: Array.from({ length: 5 }, (_, i) => product(i)) };

async function render(p: Record<string, unknown>, editable = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ProductPagesContext
          payload={p}
          brandId="b1"
          actionId="a1"
          editable={editable}
          onChanged={onChanged}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  toast.success.mockReset();
  toast.error.mockReset();
  onChanged.mockReset();
  setProductGroupSize.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('productPagesOf and groupSizeOf', () => {
  it('reads the products defensively, and a size it knows, else 5', () => {
    expect(
      productPagesOf({
        products: [product(1, { title: ' ', revenue: null }), { url: '/no' }, 'x'],
      }),
    ).toEqual([
      {
        url: `${SHOP}/products/p1`,
        title: '/products/p1',
        prompts: 3,
        aiVisits: 12,
        orders: 2,
        revenue: null,
        currency: 'USD',
      },
    ]);
    expect(groupSizeOf({ groupSize: 10 })).toBe(10);
    expect(groupSizeOf({ groupSize: 4 })).toBe(5);
    expect(groupSizeOf({})).toBe(5);
  });
});

describe('ProductPagesContext', () => {
  it('shows the group it works on, and the products after it as next', async () => {
    await render(payload);
    const lists = [...container.querySelectorAll('ul')];
    expect(lists[0].querySelectorAll('li')).toHaveLength(3);
    expect(lists[1].querySelectorAll('li')).toHaveLength(2);
    const text = container.textContent ?? '';
    expect(text).toContain('Product 0');
    expect(text).toContain('On AI shopping cards for 3 prompts');
    expect(text).toContain('2 orders · 12 AI visits in 30 days');
    expect(text).toContain('in 30 days');
    expect(button('3 pages').getAttribute('aria-pressed')).toBe('true');
  });

  it('changes the group when another size is picked, and reads the action again', async () => {
    await render(payload);
    await act(async () => button('5 pages').click());
    expect(setProductGroupSize).toHaveBeenCalledWith('b1', 'a1', 5);
    expect(toast.success).toHaveBeenCalledWith('Working on 5 product pages');
    expect(onChanged).toHaveBeenCalled();

    setProductGroupSize.mockRejectedValue(new Error('closed'));
    await act(async () => button('10 pages').click());
    expect(toast.error).toHaveBeenCalledWith('Couldn’t change the group. Try again.');
  });

  it('lets nobody change a closed action’s group', async () => {
    await render(payload, false);
    expect(button('5 pages').disabled).toBe(true);
  });
});
