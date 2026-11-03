import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { useFormAssist } from '@/components/chat/run/form-assist';
import type { ChatConfirmForm } from '@/lib/chat/events';
import { FormCard } from './form-card';

/**
 * The editable approval card (W3-02, CHAT-12 item 7): its fields as the
 * change would be made, live help as the person types (a schedule's When,
 * change-only only on a repeat), its button off while a field is missing or
 * doesn't read, the values sent with the click, Cancel, and the read-only
 * gate.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  openUpgrade.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Friday 16 October 2026, 14:00 in Istanbul.
  vi.setSystemTime(new Date('2026-10-16T11:00:00.000Z'));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const FORM: ChatConfirmForm = {
  kind: 'schedule',
  zone: 'Europe/Istanbul',
  submit: 'Create schedule',
  notes: ['Runs on Auto · Normal', '≈ 2% of monthly AI usage per run'],
  fields: [
    { name: 'title', kind: 'text', label: 'Job', value: 'Weekly report', required: true },
    { name: 'when', kind: 'text', label: 'When', value: 'every Monday at 09:00', required: true },
    {
      name: 'deliver',
      kind: 'choice',
      label: 'Deliver to',
      value: 'chat',
      options: [
        { value: 'chat', label: 'Chat' },
        { value: 'email', label: 'Email' },
        { value: 'both', label: 'Chat + Email' },
      ],
    },
    {
      name: 'changeOnly',
      kind: 'toggle',
      label: 'Notify only if the answer changed',
      value: false,
    },
  ],
};

function Schedule(props: { onSubmit: (v: unknown) => void; onCancel: () => void }) {
  const assist = useFormAssist(FORM);
  return (
    <FormCard
      step={{ n: 2, total: 2 }}
      title="Schedule work"
      form={FORM}
      assist={assist}
      onSubmit={props.onSubmit}
      onCancel={props.onCancel}
    />
  );
}

async function render(ui: ReactElement, { isLocked = false } = {}) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Istanbul">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          {ui}
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
}

const action = (id: string) => container.querySelector<HTMLElement>(`[data-action="${id}"]`);
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
async function type(el: Element | null, value: string) {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('FormCard', () => {
  it('shows the fields, the When line with its next run, and the card’s notes', async () => {
    await render(<Schedule onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(container.textContent).toContain('Step 2 of 2');
    expect(container.textContent).toContain('Schedule work');
    expect(container.textContent).toContain(
      'Every Monday, 09:00 · Europe/Istanbul · Next: Mon 19 Oct, 09:00',
    );
    expect(container.textContent).toContain('≈ 2% of monthly AI usage per run');
    expect(action('formCard.submit')!.textContent).toBe('Create schedule');
    // A repeat: "Notify only if the answer changed" is there.
    expect(action('formCard.changeOnly')).not.toBeNull();
  });

  it('sends the edited values with the click', async () => {
    const onSubmit = vi.fn();
    await render(<Schedule onSubmit={onSubmit} onCancel={vi.fn()} />);
    await type(action('formCard.title'), 'Monday citations');
    await click(container.querySelector('[data-action="formCard.deliver"][aria-checked="false"]'));
    await click(action('formCard.changeOnly'));
    await click(action('formCard.submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Monday citations',
      when: 'every Monday at 09:00',
      deliver: 'email',
      changeOnly: true,
    });
  });

  it('keeps the button off while When doesn’t read or a field is empty, and hides change-only on a one-time job', async () => {
    const onSubmit = vi.fn();
    await render(<Schedule onSubmit={onSubmit} onCancel={vi.fn()} />);
    await type(action('formCard.when'), 'next Friday');
    expect(container.textContent).toContain(
      'That could be Fri 23 Oct, 09:00 or Fri 30 Oct, 09:00. Say which one.',
    );
    expect(action('formCard.when')!.getAttribute('aria-invalid')).toBe('true');
    expect((action('formCard.submit') as HTMLButtonElement).disabled).toBe(true);

    await type(action('formCard.when'), 'tomorrow at 3pm');
    expect(container.textContent).toContain('Once, Sat 17 Oct, 15:00 · Europe/Istanbul');
    expect(action('formCard.changeOnly')).toBeNull();
    expect((action('formCard.submit') as HTMLButtonElement).disabled).toBe(false);

    await type(action('formCard.title'), '  ');
    expect((action('formCard.submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels, and sends nothing while the workspace is read-only', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    await render(<Schedule onSubmit={onSubmit} onCancel={onCancel} />, { isLocked: true });
    await click(action('formCard.submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(openUpgrade).toHaveBeenCalledWith('Approving changes needs a plan');
    await click(action('formCard.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('collapses to a green line once made, and a dashed one once skipped', async () => {
    await render(
      <FormCard
        step={{ n: 2, total: 2 }}
        title="Schedule work"
        form={FORM}
        status="approved"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-slot="done-line"]')?.textContent).toContain(
      'Step 2 approved',
    );
    await render(
      <FormCard
        step={{ n: 2, total: 2 }}
        title="Schedule work"
        form={FORM}
        status="skipped"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Step 2 skipped · Schedule work');
  });
});
