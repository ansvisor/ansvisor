import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { OpportunityFlowNote } from './opportunity-flow-note';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: ComponentProps<typeof OpportunityFlowNote>) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OpportunityFlowNote {...props} />
      </NextIntlClientProvider>,
    ),
  );
}

describe('OpportunityFlowNote', () => {
  it('says every need is covered and links to Prompts', () => {
    render({ state: 'allCovered', resetsOn: 'Dec 1', canManage: true });
    expect(container.textContent).toContain('Every need you track already has an opportunity');
    expect(container.textContent).toContain('+ New');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/prompts');
  });

  it('leaves + New out for people who cannot use it', () => {
    render({ state: 'allCovered', resetsOn: '', canManage: false });
    expect(container.textContent).not.toContain('+ New');
    expect(container.querySelector('a')).not.toBeNull();
  });

  it('says when a used-up quota renews', () => {
    render({ state: 'limit', resetsOn: 'Dec 1', canManage: true });
    expect(container.textContent).toContain('used up');
    expect(container.textContent).toContain('Dec 1');
    expect(container.querySelector('a')).toBeNull();
  });

  it('reads without a renewal date', () => {
    render({ state: 'limit', resetsOn: '', canManage: true });
    expect(container.textContent).toContain('when your plan renews');
  });
});
