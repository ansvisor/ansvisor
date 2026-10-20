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
import { RulesTab } from './_rules-tab';
import type { DraftRulesState } from './_use-draft-rules';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const change = vi.fn();
const pickSet = vi.fn();

function state(choices: DraftRules = { set: null, overrides: {} }): DraftRulesState {
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
    rules: checked,
    ...rulesMet(checked),
    length: 3000,
    change,
    pickSet,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(s: DraftRulesState) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RulesTab state={s} siteType="b2b" draftPageType="feature_page" />
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
  change.mockReset();
  pickSet.mockReset();
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

    await render(state({ set: null, overrides: { citeInline: { on: false } } }));
    const off = row('Cite sources inline');
    expect(off.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    expect(off.textContent).toContain('Off');
  });
});
