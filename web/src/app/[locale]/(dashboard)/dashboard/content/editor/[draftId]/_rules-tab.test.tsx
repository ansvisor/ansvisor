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
    // The user's case: a 3,000-character rule over a 15,921-character page.
    15921,
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
    lengthConflict: null,
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
  describe('Run Agent', () => {
    const fix = () => ({ run: vi.fn(), running: false, blocked: null as string | null });
    const show = async (props: Partial<Parameters<typeof RulesTab>[0]>, s = state()) =>
      act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={messages}>
            <RoleProvider role="admin">
              <RulesTab state={s} siteType="b2b" draftPageType="feature_page" {...props} />
            </RoleProvider>
          </NextIntlClientProvider>,
        );
      });
    const buttons = () => [...container.querySelectorAll('button')];
    const main = () =>
      buttons().find((b) => ['Run Agent', 'Rewrite page', 'Working…'].includes(b.textContent!))!;
    const trigger = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="More ways to run the agent"]')!;
    const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const reason = () => container.querySelector('[role="status"]')!;
    const openRules = () =>
      state().rules.filter(({ rule, status }) => rule.on && status.state === 'bad');

    it('opens with the open rules and one split button, recommending a rewrite far from Length', async () => {
      const agentFix = fix();
      const pageRewrite = fix();
      await show({ agentFix, pageRewrite });
      // The card first: what's open, the split button, then the ⓘ.
      expect(
        buttons()
          .map((b) => b.getAttribute('aria-label') ?? b.textContent)
          .slice(0, 3),
      ).toEqual(['Run Agent', 'More ways to run the agent', 'What Run Agent does']);
      const open = openRules();
      expect(container.textContent).toContain(`${open.length} rules are not met`);
      // The first three by name, then "…".
      const names = open.slice(0, 3).map(({ rule }) => rule.key);
      expect(names).toHaveLength(3);
      expect(container.textContent).toMatch(/rules are not met[^,]+, [^,]+, [^…]+…/);
      // 15,921 characters for a 3,000 Length.
      expect(container.querySelector('[role="note"]')!.textContent).toBe(
        'Recommended: the page is 15,921 characters for a Length of 3,000 (431% off). A rewrite gets there in one go.',
      );
      // Nothing in the way: the reason line is there for screen readers, empty.
      expect(reason().textContent).toBe('');

      // The main part runs the safe default: fix the open rules.
      await act(async () => main().click());
      expect(agentFix.run).toHaveBeenCalledTimes(1);
      expect(pageRewrite.run).not.toHaveBeenCalled();

      // ▾ offers both, Fix checked and the rewrite recommended here.
      await act(async () => trigger().click());
      expect(items().map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
        [`Fix open rules${open.length} rules · small, reviewable changesLess AI usage`, 'true'],
        [
          'Rewrite the whole pageRecommended · Every rule in “Feature page · Ansvisor default” · one new version, cited passages keptMore AI usage',
          'false',
        ],
      ]);
      // Picking the rewrite renames the button; once it runs, Fix is the default again.
      await act(async () => items()[1].click());
      expect(main().textContent).toBe('Rewrite page');
      await act(async () => main().click());
      expect(pageRewrite.run).toHaveBeenCalledTimes(1);
      expect(main().textContent).toBe('Run Agent');
    });

    it('says when the Length is out of a rewrite’s reach for what it keeps, recommending none for it', async () => {
      // 15,921 characters for 3,000, 2,900 of them passages AI answers quote and tables.
      await show({ agentFix: fix(), pageRewrite: { ...fix(), kept: 2_900 } });
      const notes = [...container.querySelectorAll('[role="note"]')].map((n) => n.textContent);
      expect(notes.some((n) => n?.startsWith('Recommended: the page is'))).toBe(false);
      expect(notes).toContainEqual(
        "The page is 15,921 characters for a Length of 3,000, but 2,900 of them are passages AI answers quote, tables and other blocks a rewrite keeps as they are. Raise the Length to about 4,500, or unlock passages you're fine to have reworded.",
      );
    });

    it('says why its choice waits under the card, for the choice picked', async () => {
      const agentFix = {
        ...fix(),
        blocked: 'Review the open suggestions first, then run the agent.',
      };
      const pageRewrite = fix();
      await show({ agentFix, pageRewrite });
      expect(main().disabled).toBe(true);
      expect(reason().textContent).toBe('Review the open suggestions first, then run the agent.');

      // The rewrite isn't held up: picking it clears the reason.
      await act(async () => trigger().click());
      await act(async () => items()[1].click());
      expect(main().textContent).toBe('Rewrite page');
      expect(main().disabled).toBe(false);
      expect(reason().textContent).toBe('');
    });

    it('shows the agent working, with ▾ closed until it is done', async () => {
      await show({ agentFix: { ...fix(), running: true }, pageRewrite: fix() });
      expect(main().textContent).toBe('Working…');
      expect(main().disabled).toBe(true);
      expect(trigger().disabled).toBe(true);
    });

    it('offers only the rewrite when the agent can fix none of the open rules', async () => {
      // Only One H1 is open: Content Agent doesn't change heading levels.
      const s = state();
      const onlyH1 = {
        ...s,
        rules: s.rules.map((r) =>
          r.rule.key === 'oneH1'
            ? {
                ...r,
                rule: { ...r.rule, on: true },
                status: { state: 'bad' as const, code: 'current' as const, count: 2 },
              }
            : r.status.state === 'bad'
              ? { ...r, status: { state: 'ok' as const } }
              : r,
        ),
      } as DraftRulesState;
      await show({ agentFix: fix(), pageRewrite: fix() }, onlyH1);
      expect(container.textContent).toContain('1 rule is not met');
      expect(main().disabled).toBe(true);
      expect(reason().textContent).toBe(
        "Content Agent doesn't change heading levels: make the extra H1s H2s in the toolbar.",
      );
      await act(async () => trigger().click());
      expect(items()[0].getAttribute('aria-disabled')).toBe('true');
      // Nothing turned off is recommended, and the page is near Length: no rewrite advice.
      expect(
        items()
          .map((item) => item.textContent)
          .join(' '),
      ).not.toContain('Recommended');
    });

    it('says all rules are met, with nothing to run', async () => {
      const s = state();
      const met = {
        ...s,
        rules: s.rules.map((r) =>
          r.status.state === 'bad' ? { ...r, status: { state: 'ok' as const } } : r,
        ),
      } as DraftRulesState;
      await show({ agentFix: fix(), pageRewrite: fix() }, met);
      expect(container.textContent).toContain('All rules are met');
      expect(main()).toBeUndefined();
      expect(trigger()).toBeNull();
    });

    it('keeps Run Agent plain without a rewrite (a page ready or published)', async () => {
      const agentFix = fix();
      await show({ agentFix });
      expect(trigger()).toBeNull();
      expect(container.querySelector('[role="note"]')).toBeNull();
      await act(async () => main().click());
      expect(agentFix.run).toHaveBeenCalled();
    });
  });

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
    // Over the band, said short on the badge and in full on hover.
    expect(row('Length').textContent).toContain('15,921 · over');
    expect(row('Length').querySelector('[title*="characters"]')?.getAttribute('title')).toBe(
      '15,921 characters, over 2,400–3,600',
    );
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

  it('says under Length when the other rules can’t fit in it (C)', async () => {
    await render(state());
    expect(row('Length').querySelector('.text-amber-700')).toBeNull();
    await render(state(undefined, { lengthConflict: { need: 2350, max: 1200 } }));
    expect(row('Length').textContent).toContain(
      'The fan-out H2s, FAQ questions and summary these rules still ask for take about 2,350 characters, more than Length allows (up to 1,200). Raise Length, or ask for fewer.',
    );
    // Off, Length asks for nothing.
    await render(
      state(
        { overrides: { length: { on: false } } },
        { lengthConflict: { need: 2350, max: 1200 } },
      ),
    );
    expect(row('Length').textContent).not.toContain('Raise Length');
  });

  it('shows Ansvisor’s set when a draft on My rules has none for its type', async () => {
    await render(state(undefined, { source: 'mine', mineTypes: [] }));
    const trigger = container.querySelector('[aria-label="Rule set"]')!;
    expect(trigger.textContent).toContain('Feature page · Ansvisor default');
    expect(trigger.textContent).not.toContain('mine:');
  });
});
