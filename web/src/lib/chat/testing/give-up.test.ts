import { describe, expect, it } from 'vitest';
import {
  AGENT_SCENARIOS,
  gradeAgentRun,
  SKILL_SCENARIOS,
  type AgentEvalRun,
  type AgentEvalScenario,
} from './agent-eval';
import { giveUpPhrases, lookedUp } from './give-up';
import {
  EVAL_ACTIONS,
  EVAL_CITED_DOMAINS,
  EVAL_PAST_FIRST_PAGE,
  EVAL_SCENARIOS,
  EVAL_SIGNALS,
  gradeRun,
  type EvalRun,
} from './model-eval';

/**
 * The owner's rule (2026-11-16): no answer says it couldn't read, reach or
 * find what it could have read. Both evals fail one, in English and Turkish.
 */

describe('giveUpPhrases', () => {
  it('finds giving up, in English and Turkish', () => {
    for (const [text, found] of [
      ["I couldn't read the rest of the actions.", "couldn't read, reach or access"],
      ['I could not access your citations data.', "couldn't read, reach or access"],
      ["I wasn't able to fully read the signals.", "couldn't read, reach or access"],
      ['I hit the read limit for this run.', 'a read limit'],
      ['I reached the limit of what I can read here.', 'hit the limit'],
      ['38 actions are missing from this list.', 'a count of missing items'],
      ['The first 50 rows are below.', '"rows"'],
      ['Okuma sınırına takıldım.', 'okuma sınırı'],
      ['Aksiyonların hepsini okuyamadım.', 'okuyamadım, ulaşamadım, erişemedim'],
      ['Sinyallere ulaşamadım.', 'okuyamadım, ulaşamadım, erişemedim'],
      ['Verilere erişemedim.', 'okuyamadım, ulaşamadım, erişemedim'],
      ['38 aksiyon eksik.', 'eksik (about the data)'],
      ['Sinyal verisi eksik.', 'eksik (about the data)'],
      ['AC-481’i bulamadım.', 'bulamadım'],
      ["I couldn't find AC-481.", "couldn't find"],
    ] as const) {
      expect(giveUpPhrases(text), text).toContain(found);
    }
  });

  it('passes an answer that says what it covers, or a page that lacks something', () => {
    for (const text of [
      'The newest 50 of 451 signals: most are citations lost on Perplexity.',
      'Showing the top 50 of 53 open actions, by Priority Score.',
      "Your Perplexity visibility fell 8 points in the last 30 days; ChatGPT's rose 2.",
      'Sayfada FAQ şeması eksik: eklemek görünürlüğü artırabilir.',
      'Three weeks in a row, visibility rose.',
      "I can't give investment advice. I can build a share-of-voice report instead.",
      'Son 30 günün en yeni 50 sinyali (toplam 451).',
    ]) {
      expect(giveUpPhrases(text), text).toEqual([]);
    }
  });

  it('lets "not found" follow a direct lookup, and "can\'t access" a true refusal', () => {
    expect(giveUpPhrases('This brand has no action AC-481: not found.')).toContain("couldn't find");
    expect(
      giveUpPhrases('This brand has no action AC-481: not found.', { lookedUp: true }),
    ).toEqual([]);
    expect(giveUpPhrases("I can't access Search Console: it isn't connected.")).toHaveLength(1);
    expect(
      giveUpPhrases("I can't access Search Console: it isn't connected.", { refused: true }),
    ).toEqual([]);
    // Never, refused or not: a read limit, rows, or a count of missing items.
    expect(
      giveUpPhrases('I hit the read limit; 38 rows are missing.', {
        refused: true,
        lookedUp: true,
      }),
    ).toEqual(['a read limit', '"rows"', 'a count of missing items']);
  });

  it('reads a lookup from what the run read by: a code, an id, words or an address', () => {
    expect(lookedUp([{ brand_id: 'b1' }, { brand_id: 'b1', offset: 50 }])).toBe(false);
    expect(lookedUp([{ brand_id: 'b1', codes: ['AC-481'] }])).toBe(true);
    expect(lookedUp([{ action_id: 'a1' }])).toBe(true);
    expect(lookedUp([{ brand_id: 'b1', codes: [] }])).toBe(false);
    // The other lookups by code, id, words, domain or address (the owner's plan, 2026-11-16).
    expect(lookedUp([{ brand_id: 'b1', domains: ['example.com'] }])).toBe(true);
    expect(lookedUp([{ brand_id: 'b1', urls: ['https://example.com/a'] }])).toBe(true);
    expect(lookedUp([{ brand_id: 'b1', prompt_ids: ['p1'] }])).toBe(true);
    expect(lookedUp([{ brand_id: 'b1', search: '' }])).toBe(false);
  });
});

const run = (over: Partial<EvalRun>): EvalRun => ({
  status: 'done',
  answer: '',
  reads: [],
  changes: [],
  cards: 0,
  asks: 0,
  denials: 0,
  leaked: [],
  tokens: { input: 0, output: 0 },
  ...over,
});
const scenario = (id: string) => EVAL_SCENARIOS.find((s) => s.id === id)!;
const failed = (id: string, over: Partial<EvalRun>) =>
  gradeRun(scenario(id), run(over))
    .checks.filter((c) => !c.ok)
    .map((c) => `${c.must ? 'must' : 'review'}: ${c.name}`);

describe("the model eval's scenarios for reading all a page shows", () => {
  const page2 = { tool: 'list_action_center_tasks', input: { brand_id: 'b1', offset: 50 } };

  it('give lists past one page, and a page of them as Chat reads it', () => {
    expect(EVAL_ACTIONS).toHaveLength(55);
    expect(EVAL_ACTIONS.findIndex((a) => a.ref === EVAL_PAST_FIRST_PAGE.ref)).toBeGreaterThan(49);
    expect(EVAL_SIGNALS).toHaveLength(451);
    expect(EVAL_CITED_DOMAINS).toHaveLength(180);
    const signals = scenario('long-list').readResult!('list_signals', { limit: 50 });
    expect(signals).toMatchObject({ total: 451, offset: 0, next_offset: 50 });
    const second = scenario('action-past-first-page').readResult!('list_action_center_tasks', {
      offset: 50,
      limit: 50,
    }) as { actions: { ref: string }[] };
    expect(second.actions.map((a) => a.ref)).toContain(EVAL_PAST_FIRST_PAGE.ref);
    // By its code too, when the read takes codes (fix/chat-action-by-code).
    expect(
      scenario('action-past-first-page').readResult!('list_action_center_tasks', {
        codes: ['AC 63'],
      }),
    ).toMatchObject({ actions: [{ ref: EVAL_PAST_FIRST_PAGE.ref }], not_found: [] });
    // Other reads answer with the test's numbers.
    expect(scenario('long-list').readResult!('get_visibility_summary', {})).toBeUndefined();
  });

  it('pass an action past the first page read and named, and fail one given up on', () => {
    expect(
      failed('action-past-first-page', {
        readCalls: [page2],
        answer: '**/pricing sayfasına FAQ şeması ekle** (AC-63): açık bir aksiyon.',
      }),
    ).toEqual([]);
    expect(
      failed('action-past-first-page', {
        readCalls: [{ tool: 'list_action_center_tasks', input: { brand_id: 'b1' } }],
        answer: 'Okuma sınırına takıldım; AC-63 eksik, bulamadım.',
      }),
    ).toEqual([
      'must: never gives up on data it could read',
      'must: reads past the first page, or by its code',
      'must: names what it is about',
    ]);
  });

  it('want the total of a long list, and the next page or the total of a cut one', () => {
    expect(
      failed('long-list', { reads: ['list_signals'], answer: 'The newest 50 of 451.' }),
    ).toEqual(['review: says the period']);
    expect(
      failed('long-list', {
        reads: ['list_signals'],
        answer: 'I read the first 50 signals this month; 401 rows were cut off.',
      }),
    ).toEqual(['must: never gives up on data it could read', 'must: says how many there are']);
    expect(
      failed('cut-by-size', {
        reads: ['list_citations', 'list_citations'],
        readCalls: [{ tool: 'list_citations', input: { offset: 38 } }],
        answer: 'The most cited domains: source-1.example leads.',
      }),
    ).toEqual([]);
    expect(
      failed('cut-by-size', {
        reads: ['list_citations'],
        answer: "I couldn't read all of the domains: the result was cut.",
      }),
    ).toEqual([
      'must: never gives up on data it could read',
      'must: reads on, or says how many there are',
    ]);
  });

  it("want another page's data read on this one", () => {
    expect(
      failed('other-page-data', {
        reads: ['get_prompt_performance'],
        answer: '"best crm for small teams" en çok düşen prompt oldu: 12 puan.',
      }),
    ).toEqual([]);
    expect(
      failed('other-page-data', {
        reads: ['list_signals'],
        answer: 'Bu sayfadan prompt verisine ulaşamadım; görünürlük düşüşünü göremiyorum.',
      }),
    ).toEqual([
      'must: never gives up on data it could read',
      "must: reads beyond the Signals page's own data",
      'must: names the prompt that lost most',
    ]);
  });

  it('let a true refusal say so', () => {
    expect(
      failed('analyst-denied', {
        denials: 1,
        answer: "Your role is Analyst, so you can't access competitor settings. Ask an Admin.",
      }),
    ).toEqual([]);
  });
});

describe("the agents' eval", () => {
  const scenario: AgentEvalScenario = {
    id: 'visibility-watch',
    group: 'agents',
    agent: 'visibility-watch',
    name: 'Visibility Watch',
    skills: [],
    mode: 'auto',
    trigger: 'schedule',
    promises: [],
  };
  const agentRun = (answer: string, over: Partial<AgentEvalRun> = {}): AgentEvalRun => ({
    status: 'done',
    agentStatus: 'done',
    stopReason: null,
    answer,
    reads: [],
    readInputs: [],
    changes: [],
    cards: [],
    questions: 0,
    denials: 0,
    leaked: [],
    outputs: [],
    readValues: [],
    givenText: '',
    steps: [],
    skillsLoaded: [],
    modelSteps: 2,
    durationMs: 1000,
    tokens: {},
    costUsd: 0,
    capUsd: null,
    monthLeftUsd: 10,
    capHit: null,
    blocked: [],
    missingConnections: [],
    ...over,
  });
  const gaveUp = (run: AgentEvalRun) =>
    gradeAgentRun(scenario, run).checks.find(
      (c) => c.name === 'never gives up on data it could read',
    );

  it('fails every agent and skill run that gives up, as a must', () => {
    expect(gaveUp(agentRun('Visibility held this week.'))).toMatchObject({ ok: true, must: true });
    expect(
      gaveUp(agentRun("I couldn't read the citations; 12 prompts are missing.")),
    ).toMatchObject({ ok: false, must: true });
    expect(gaveUp(agentRun('Sinyallere ulaşamadım.'))).toMatchObject({ ok: false });
  });

  it('holds for every agent and skill scenario, the actions asked by their code too', () => {
    for (const each of [...AGENT_SCENARIOS, ...SKILL_SCENARIOS]) {
      const check = gradeAgentRun(each, agentRun('Done.')).checks.find(
        (c) => c.name === 'never gives up on data it could read',
      );
      expect(check, each.id).toMatchObject({ must: true });
    }
    const byCode = SKILL_SCENARIOS.find((s) => s.id === 'action-by-code')!;
    const giveUp = (run: AgentEvalRun) =>
      gradeAgentRun(byCode, run).checks.find(
        (c) => c.name === 'never gives up on data it could read',
      );
    // A page of the list read, then "couldn't find": given up on.
    expect(
      giveUp(
        agentRun('AC-481’i bulamadım; AC-63 açık bir aksiyon.', {
          readInputs: [{ brand_id: 'b1' }],
        }),
      ),
    ).toMatchObject({ ok: false, must: true });
    // Read by its code, a code the brand hasn't may be "not found".
    expect(
      giveUp(
        agentRun('AC-481 bu markada bulunamadı.', {
          readInputs: [{ brand_id: 'b1', codes: ['AC 481', 'AC-63'] }],
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('lets a missing connection or a direct lookup say so', () => {
    expect(
      gaveUp(
        agentRun("I can't access Google Analytics: it isn't connected.", {
          missingConnections: ['Google Analytics'],
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      gaveUp(
        agentRun('AC-481 bu markada bulunamadı.', {
          readInputs: [{ brand_id: 'b1', codes: ['AC-481'] }],
        }),
      ),
    ).toMatchObject({ ok: true });
  });
});
