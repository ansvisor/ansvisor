import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import {
  activeRules,
  checkRule,
  readPage,
  ruleSet,
  rulesMet,
  type DraftRules,
} from '@/lib/content/rules';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { RulesTab } from './_rules-tab';
import type { DraftRulesState } from './_use-draft-rules';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const change = vi.fn();
const pickSet = vi.fn();
const addTextRules = vi.fn();
const changeTextRule = vi.fn();
const saveAsMine = vi.fn();
const reset = vi.fn();

function state(
  choices: Pick<DraftRules, 'overrides'> = { overrides: {} },
  extra: Partial<DraftRulesState> = {},
): DraftRulesState {
  const rules = activeRules(ruleSet('feature_page'), choices);
  const page = readPage(
    '<h1>Pipeline forecasting</h1><p>A seamless way to forecast in 2026.</p><table><tr><td>x</td></tr></table>',
    2610,
  );
  const checked = rules.map((rule) => ({
    rule,
    status: checkRule(rule, page, { brandDomains: [], competitorDomains: [], fanouts: [] }),
  }));
  return {
    setType: 'feature_page',
    source: 'default',
    rules: checked,
    textRules: [],
    mineTypes: [],
    ready: true,
    ...rulesMet(checked),
    length: 3000,
    change,
    pickSet,
    addTextRules,
    changeTextRule,
    saveAsMine,
    reset,
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(s: DraftRulesState, role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <RulesTab state={s} siteType="b2b" draftPageType="feature_page" />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const row = (name: string) =>
  [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!;
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [change, pickSet, addTextRules, changeTextRule, saveAsMine, reset])
    fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Rules tab', () => {
  it('lists the page type’s rules, then the shared groups, each with its status', async () => {
    const s = state();
    await render(s);
    expect([...container.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
      'Feature page rules',
      'Length and structure',
      'Fan-outs and keywords',
      'Links and sources',
      'Style',
    ]);
    expect(container.textContent).toContain(`${s.met} of ${s.total} rules met`);
    expect(row('Comparison table vs alternatives').textContent).toContain('✓');
    expect(row("Who it's for").textContent).toContain('Not set');
    expect(row('Length').textContent).toContain('2,610');
    expect(row('Banned words').textContent).toContain('1 found');
    expect(row('Tone').textContent).toContain('AI check');
    expect(row('Use top fan-outs as H2s').textContent).toContain('No fan-outs');
  });

  it('changes a value for this draft when the field is left', async () => {
    await render(state());
    const input = row('Max sentence length').querySelector('input')!;
    await act(async () => {
      input.focus();
      setValue(input, '120');
    });
    await act(async () => input.blur());
    expect(change).toHaveBeenCalledWith('sentence', { value: '120' });

    // A number rule keeps a number.
    change.mockReset();
    await act(async () => {
      input.focus();
      setValue(input, 'many');
    });
    await act(async () => input.blur());
    expect(change).not.toHaveBeenCalled();

    const who = row("Who it's for").querySelector('input')!;
    await act(async () => {
      who.focus();
      setValue(who, 'Sales leaders at B2B teams');
    });
    await act(async () => who.blur());
    expect(change).toHaveBeenCalledWith('whoFor', { value: 'Sales leaders at B2B teams' });
  });

  it('turns a rule off, and shows it off', async () => {
    await render(state());
    await act(async () =>
      row('Cite sources inline').querySelector<HTMLElement>('[role="switch"]')!.click(),
    );
    expect(change).toHaveBeenCalledWith('citeInline', { on: false });

    await render(state({ overrides: { citeInline: { on: false } } }));
    const off = row('Cite sources inline');
    expect(off.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(off.textContent).toContain('Off');
  });
  it('lists the rules in the person’s own words, edited in place', async () => {
    await render(
      state(undefined, {
        textRules: [
          { rule: { id: 'a', text: 'Use at least 3 images', on: true }, check: 'numberCheck' },
          { rule: { id: 'b', text: 'Mention free shipping', on: false }, check: 'aiCheck' },
        ],
      }),
    );
    expect(container.textContent).toContain('Your text rules');
    const inputs = [
      ...container.querySelectorAll<HTMLInputElement>('input[aria-label="Edit rule"]'),
    ];
    expect(inputs.map((i) => i.value)).toEqual(['Use at least 3 images', 'Mention free shipping']);
    expect(inputs[0].closest('li')!.textContent).toContain('Number check');
    expect(inputs[1].closest('li')!.textContent).toContain('Off');

    await act(async () => {
      inputs[0].focus();
      setValue(inputs[0], 'Use at least 4 images');
    });
    await act(async () => inputs[0].blur());
    expect(changeTextRule).toHaveBeenCalledWith('a', { text: 'Use at least 4 images' });

    await act(async () =>
      inputs[1].closest('li')!.querySelector<HTMLElement>('[role="switch"]')!.click(),
    );
    expect(changeTextRule).toHaveBeenCalledWith('b', { on: true });
  });

  it('adds a rule written in the box, one per line', async () => {
    await render(state());
    const box = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Write a rule"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        box,
        '- Mention free shipping\n2) Use 3 images',
      );
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
    await act(async () => add.click());
    expect(addTextRules).toHaveBeenCalledWith(['Mention free shipping', 'Use 3 images']);
    expect(box.value).toBe('');
  });

  it('saves the set as My rules, or resets it', async () => {
    await render(state());
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
    await act(async () => button('Save as my rules').click());
    expect(saveAsMine).toHaveBeenCalled();
    await act(async () => button('Reset').click());
    expect(reset).toHaveBeenCalled();
  });

  it('leaves saving My rules to admins and managers', async () => {
    const saveButton = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save as my rules');
    await render(state(), 'manager');
    expect(saveButton()).toBeDefined();
    for (const role of ['analyst', 'agency_partner'] as const) {
      await render(state(), role);
      expect(saveButton()).toBeUndefined();
      // Reset is the draft's own: anyone can.
      expect(container.textContent).toContain('Reset');
    }
  });

  it('keeps every control off until My rules are read', async () => {
    await render(state(undefined, { ready: false }));
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    await render(state());
    expect(container.querySelector('fieldset')!.disabled).toBe(false);
  });

  it('shows Ansvisor’s set when a draft on My rules has none for its type', async () => {
    await render(state(undefined, { source: 'mine', mineTypes: [] }));
    const trigger = container.querySelector('[aria-label="Rule set"]')!;
    expect(trigger.textContent).toContain('Feature page · Ansvisor default');
    expect(trigger.textContent).not.toContain('mine:');
  });
});
