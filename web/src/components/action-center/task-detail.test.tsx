import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { parseTaskDetails } from '@/lib/action-center/task-details';
import { TaskDetailForm, TaskDetailView, TaskTypeBadge } from './task-detail';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Types into a field the way a person does, so React's onChange runs. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(field) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const field = (label: string) => {
  const target = [...container.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  );
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id="${target?.getAttribute('for')}"]`,
  )!;
};

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

const details = parseTaskDetails({
  where: 'acme.example/blog/best-tools · 3 prompts on ChatGPT',
  why: 'Cited #2 until Oct 8.',
  how: ['Add a feature table.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again on 2 of 3 platforms within 14 days.',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
});

describe('TaskDetailView', () => {
  it('shows where, why, the steps in order, done-when and the effort', () => {
    render(<TaskDetailView details={details} disabled={false} onEdit={() => {}} />);
    const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms).toEqual(['Where', 'Why', 'How', 'Done when', 'Effort']);
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Add a feature table.',
      'Put "2026" in the title.',
    ]);
    expect(container.textContent).toContain('~2h · Content writer');
  });

  it('asks for details when a task has none, and opens the editor', () => {
    const onEdit = vi.fn();
    render(<TaskDetailView details={null} disabled={false} onEdit={onEdit} />);
    expect(container.textContent).toContain('No details yet');
    act(() => button('Edit').click());
    expect(onEdit).toHaveBeenCalled();
  });

  it("keeps an Improve task's body and evidence", () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          body: 'Lead with the table.',
          platformLabel: 'ChatGPT',
          sources: [{ type: 'answer', ref: '9c1e' }],
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    expect(container.textContent).toContain('Lead with the table.');
    expect(container.textContent).toContain('AI answer');
    expect(container.textContent).not.toContain('No details yet');
  });
});

describe('TaskDetailView without a body', () => {
  it("shows an Improve task's evidence without asking for details", () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          platformLabel: 'Gemini',
          sources: [{ type: 'domain', ref: 'g2.com' }],
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    expect(container.textContent).toContain('g2.com');
    expect(container.textContent).not.toContain('No details yet');
  });
});

describe('TaskDetailForm', () => {
  it('saves every field, one step per line, and leaves an unchanged text alone', () => {
    const onSave = vi.fn();
    render(
      <TaskDetailForm
        text="Refresh /pricing"
        details={details}
        disabled={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    type(field('How'), 'Add a table.\n\nUpdate the title.');
    type(field('Role'), 'Editor');
    act(() => button('Save').click());
    expect(onSave).toHaveBeenCalledWith({
      title: null,
      where: 'acme.example/blog/best-tools · 3 prompts on ChatGPT',
      why: 'Cited #2 until Oct 8.',
      how: ['Add a table.', '', 'Update the title.'],
      doneWhen: 'Cited again on 2 of 3 platforms within 14 days.',
      type: 'content',
      effort: '~2h',
      role: 'Editor',
    });
  });

  it('saves a new text, and refuses an empty one', () => {
    const onSave = vi.fn();
    render(
      <TaskDetailForm
        text="Refresh /pricing"
        details={null}
        disabled={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    type(field('What'), '   ');
    expect(button('Save').disabled).toBe(true);
    type(field('What'), 'Add a 2026 table to /pricing');
    act(() => button('Save').click());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Add a 2026 table to /pricing', type: null }),
    );
  });
});

describe('TaskTypeBadge', () => {
  it('names the type, and shows nothing without one', () => {
    render(<TaskTypeBadge type="on_page" />);
    expect(container.textContent).toBe('On-page');
    render(<TaskTypeBadge type={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('sending a task (AC-004)', () => {
  const send = (over = {}) => ({ content: true, webhook: true, onSend: vi.fn(), ...over });

  it('offers Content for a content task and the webhook when the brand has one', () => {
    const options = send();
    render(<TaskDetailView details={details} disabled={false} onEdit={() => {}} send={options} />);
    act(() => button('Send to Content').click());
    act(() => button('Send to webhook').click());
    expect(options.onSend.mock.calls).toEqual([['content'], ['webhook']]);
  });

  it('shows where it went, and links to the opportunity instead of sending again', () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          where: '/pricing',
          type: 'content',
          sent: {
            content: { opportunityId: 'o1', at: '2026-10-16T10:00:00Z' },
            webhook: { at: '2026-10-16T11:00:00Z' },
          },
        })}
        disabled={false}
        onEdit={() => {}}
        send={send()}
      />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/content?opportunity=o1',
    );
    expect(container.textContent).toContain('Sent to the webhook on Oct 16');
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Edit',
      'Send to webhook again',
    ]);
  });

  it('offers nothing it cannot do', () => {
    render(
      <TaskDetailView
        details={details}
        disabled={false}
        onEdit={() => {}}
        send={send({ content: false, webhook: false })}
      />,
    );
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Edit']);
  });
});
