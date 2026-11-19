import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import english from '../../../messages/en.json';

/**
 * Approval cards' cost lines in the person's language: their profile's pick,
 * English for no pick, an unknown one or a failed read, and English for a
 * line the language has no text for yet.
 */

const profile = vi.hoisted(() => ({
  row: null as { ui_language: unknown } | null,
  fail: false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (profile.fail) throw new Error('down');
            return { data: profile.row, error: null };
          },
        }),
      }),
    }),
  },
}));

vi.mock('@/i18n/messages', () => ({
  loadMessages: async (locale: string) =>
    locale === 'de'
      ? {
          ...english,
          chatEngine: {
            ...english.chatEngine,
            costs: {
              ...english.chatEngine.costs,
              siteAudit:
                '{count, plural, one {Nutzt # Audit} other {Nutzt # Audits}} von {left} übrigen in diesem Monat',
            },
            step: { ...english.chatEngine.step, skipped: 'Übersprungen' },
          },
          chatDenial: {
            ...english.chatDenial,
            askedTarget: 'Ihre Anfrage: {action} · {target}.',
          },
          chatTools: {
            ...english.chatTools,
            dismissSuggestion: {
              ...english.chatTools.dismissSuggestion,
              name: 'Prompt-Vorschläge verwerfen',
            },
          },
          chatMemory: {
            ...english.chatMemory,
            card: { ...english.chatMemory.card, sent: 'An Ihre Admins gesendet' },
          },
        }
      : english,
}));

const { cardLocaleOf, costLinesFor } = await import('./card-locale');
const { chatTranslator, inEnglish, inRunLocale, runLocale, withRunLocale } =
  await import('./run-locale');
const { buildDenial } = await import('./denial');
const { memoryDoneStep } = await import('./memory/card');
const { defineTool } = await import('./registry/define-tool');
const { createTranslator } = await import('next-intl');

describe('cardLocaleOf', () => {
  beforeEach(() => {
    profile.row = null;
    profile.fail = false;
  });

  it("reads the person's interface language", async () => {
    profile.row = { ui_language: 'de' };
    expect(await cardLocaleOf('user-1')).toBe('de');
  });

  it('is English with no pick, an unknown pick or a failed read', async () => {
    expect(await cardLocaleOf('user-1')).toBe('en');
    profile.row = { ui_language: 'xx' };
    expect(await cardLocaleOf('user-1')).toBe('en');
    profile.fail = true;
    expect(await cardLocaleOf('user-1')).toBe('en');
  });
});

describe('costLinesFor', () => {
  it('writes the line in the language', async () => {
    const line = await costLinesFor('de');
    expect(line('siteAudit', { count: 2, left: 8 })).toBe(
      'Nutzt 2 Audits von 8 übrigen in diesem Monat',
    );
  });

  it('falls back to English where the language has no text', async () => {
    const line = await costLinesFor('de');
    expect(line('siteAuditUnknown', { count: 1 })).toBe("Uses 1 of this month's audits");
  });

  it('is English by default', async () => {
    const line = await costLinesFor();
    expect(line('siteAudit', { count: 1, left: 4 })).toBe('Uses 1 audit of 4 left this month');
  });
});

describe('chatTranslator', () => {
  it('writes a namespace in the language, English where it has no text', async () => {
    const step = await chatTranslator('de', 'chatEngine.step');
    expect(step('skipped')).toBe('Übersprungen');
    expect(step('failed')).toBe(english.chatEngine.step.failed);
    expect((await chatTranslator('en', 'chatEngine.step'))('skipped')).toBe('Skipped');
  });
});

/**
 * A run's words for its person (notices, refusals, cards) in their
 * language; what a model reads stays English (inEnglish).
 */
describe('the run language', () => {
  const stepT = inRunLocale(
    createTranslator({ locale: 'en', messages: english, namespace: 'chatEngine.step' }),
    'chatEngine.step',
  );

  it('is English outside a run', () => {
    expect(runLocale()).toBe('en');
    expect(stepT('skipped')).toBe('Skipped');
  });

  it("writes in the person's language inside one, English where it has no text", async () => {
    await withRunLocale('de', async () => {
      expect(runLocale()).toBe('de');
      expect(stepT('skipped')).toBe('Übersprungen');
      expect(stepT('failed')).toBe(english.chatEngine.step.failed);
      expect(stepT.has('skipped')).toBe(true);
    });
  });

  it('keeps what the model reads in English, inside a run too', async () => {
    await withRunLocale('de', async () => {
      expect(inEnglish(() => stepT('skipped'))).toBe('Skipped');
      expect(stepT('skipped')).toBe('Übersprungen');
    });
  });

  it('is English for an English person', async () => {
    await withRunLocale('en', async () => {
      expect(stepT('skipped')).toBe('Skipped');
    });
  });

  const dismiss = defineTool({
    name: 'dismiss_prompt_suggestion',
    labelKey: 'dismissSuggestion',
    area: 'content',
    description: 'fixture',
    class: 'write',
    minRole: 'manager',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    planGate: null,
    brandOf: null,
    costClass: 'C1',
    route: null,
    mcpTool: null,
    specRow: '0',
    inputSchema: z.object({}),
    run: async () => null,
    fixture: { input: {} },
  } as never);
  const demo = () =>
    buildDenial(
      { code: 'demo_brand' },
      { tool: dismiss, role: 'admin', plan: null, target: 'Brewline Coffee' },
    );

  it("writes a refusal card in the person's language, and in English for the model", async () => {
    expect(demo().asked).toBe('You asked: Dismiss prompt suggestions · Brewline Coffee.');
    await withRunLocale('de', async () => {
      expect(demo().asked).toBe('Ihre Anfrage: Prompt-Vorschläge verwerfen · Brewline Coffee.');
      // A part with no German text yet stays English.
      expect(demo().rule.detail).toBe(english.chatDenial.rule.demo_brand);
      expect(inEnglish(demo).asked).toBe(
        'You asked: Dismiss prompt suggestions · Brewline Coffee.',
      );
    });
  });

  it("writes a card's done step in the person's language", async () => {
    expect(memoryDoneStep({ requested: true })?.label).toBe('Sent to your Admins');
    await withRunLocale('de', async () => {
      expect(memoryDoneStep({ requested: true })?.label).toBe('An Ihre Admins gesendet');
    });
  });
});
