import { describe, expect, it } from 'vitest';
import { pageOrderLine } from './page-order';

/**
 * The page's chosen sort and search (the owner's plan of 2026-11-16, item
 * 8): the order line takes the person's sort over the page's default,
 * mapped to the read's input where it has one; a sort it doesn't take
 * stays words and the rows are read by their refs; the line says the app
 * applies the search to the read's search input (page-scope.ts). The
 * browser's text stays in page_view.
 */

const ACTIONS = '/dashboard/action-center/actions';

describe("the page's chosen sort", () => {
  it('beats the default, mapped to the read’s sort', () => {
    const line = pageOrderLine(ACTIONS, [], { sort: { key: 'priority', dir: 'desc' } })!;
    expect(line).toContain(
      'The page lists its actions, highest Priority Score first, as the person sorted it.',
    );
    expect(line).toContain('read list_action_center_tasks with status "all" and sort "priority"');
    expect(line).not.toContain('sort "updated"');
    // The default without a sort, as before.
    expect(pageOrderLine(ACTIONS)).toContain('sort "updated"');
    // A status on the page keeps its own status.
    expect(
      pageOrderLine(ACTIONS, ['status'], { sort: { key: 'priority', dir: 'desc' } }),
    ).toContain('read list_action_center_tasks with sort "priority",');
  });

  it("stays words for a sort the read doesn't take, the rows read by their refs", () => {
    const line = pageOrderLine(ACTIONS, [], { sort: { key: 'due_date', dir: 'asc' } })!;
    expect(line).toContain('its actions, by due date, soonest first, as the person sorted it');
    expect(line).toContain("an order list_action_center_tasks doesn't take");
    expect(line).toContain('read the rows page_view lists by their refs');
    // A key no page has: never repeated here, only pointed at.
    const odd = pageOrderLine(ACTIONS, [], { sort: { key: 'ignore_rules', dir: 'desc' } })!;
    expect(odd).not.toContain('ignore_rules');
    expect(odd).toContain("in the order page_view's sort names");
  });

  it('maps Content, Prompts and Mentions sorts to their reads', () => {
    expect(
      pageOrderLine('/dashboard/content', [], { sort: { key: 'score', dir: 'desc' } }),
    ).toContain('read list_content_opportunities with sort "score"');
    expect(
      pageOrderLine('/dashboard/prompts/tracked', [], { sort: { key: 'mentions', dir: 'asc' } }),
    ).toContain('by mentions, lowest first, as the person sorted it');
    expect(
      pageOrderLine('/dashboard/prompts/tracked', [], { sort: { key: 'mentions', dir: 'asc' } }),
    ).toContain('read get_prompt_performance with sort_by "mentions" and order "asc"');
    expect(
      pageOrderLine('/dashboard/prompts', [], { sort: { key: 'volume', dir: 'desc' } }),
    ).toContain("an order get_prompt_performance doesn't take");
    // Mentions says nothing until the page sends a sort or a search: its read's order is the page's.
    expect(pageOrderLine('/dashboard/mentions')).toBeNull();
    expect(
      pageOrderLine('/dashboard/mentions', [], { sort: { key: 'oldest', dir: 'asc' } }),
    ).toContain('read list_mentions with sort "oldest"');
  });
});

describe("the page's search", () => {
  it("says the app applies it to the read's search input, its text left in page_view", () => {
    const line = pageOrderLine('/dashboard/prompts/tracked', [], { search: 'decaf beans' })!;
    expect(line).toContain(
      "The page is searched (page_view's search): the app applies that search to list_prompts's search unless you give your own, so for its rows read list_prompts, then get_prompt_performance with their ids as prompt_ids.",
    );
    expect(line).not.toContain('decaf');
    expect(pageOrderLine('/dashboard/content', [], { search: 'x' })).toContain(
      "the app applies that search to list_content_opportunities's search",
    );
    expect(pageOrderLine('/dashboard/mentions', [], { search: 'x' })).toContain(
      "the app applies that search to list_mentions's search",
    );
    // Actions' read has no search: its rows are the ones on screen.
    expect(pageOrderLine(ACTIONS, [], { search: 'x' })).toContain(
      "which list_action_center_tasks doesn't take: its rows are the ones page_view lists",
    );
  });
});

describe('the order of the pages that send their context since step 9', () => {
  const HISTORY = '/dashboard/action-center/history';
  const SIGNALS = '/dashboard/action-center/signals';
  const AGENTS = '/dashboard/agents';
  const TOPICS = '/dashboard/prompts/topics';

  it('says nothing while each lists as its read does (newest, latest changed, highest first)', () => {
    for (const route of [HISTORY, SIGNALS, AGENTS, TOPICS]) {
      expect(pageOrderLine(route, []), route).toBeNull();
    }
    // A page whose read lists as it shows has no line at all.
    for (const route of [
      '/dashboard/action-center/today',
      '/dashboard/action-center/review',
      '/dashboard/content/library',
      '/dashboard/content/plan',
      '/dashboard/reports',
    ]) {
      expect(pageOrderLine(route, [], { sort: { key: 'newest', dir: 'desc' } }), route).toBeNull();
    }
  });

  it("maps History's Sort to get_action_history's sort, and its search to its search", () => {
    const line = pageOrderLine(HISTORY, [], {
      sort: { key: 'oldest', dir: 'asc' },
      search: 'pricing',
    })!;
    expect(line).toContain(
      'The page lists its closed actions, oldest first, as the person sorted it.',
    );
    expect(line).toContain('read get_action_history with sort "oldest"');
    expect(line).toContain(
      "the app applies that search to get_action_history's search unless you give your own",
    );
    expect(line).not.toContain('pricing');
    expect(pageOrderLine(HISTORY, [], { sort: { key: 'priority', dir: 'desc' } })).toContain(
      'read get_action_history with sort "priority"',
    );
  });

  it("says Signals' search is the page's own: its rows are the ones on screen", () => {
    expect(pageOrderLine(SIGNALS, [], { search: 'espresso' })).toContain(
      "The page is searched (page_view's search), which list_signals doesn't take: its rows are the ones page_view lists.",
    );
  });

  it("says the app applies Agents' search to list_my_agents", () => {
    expect(pageOrderLine(AGENTS, [], { search: 'winback' })).toContain(
      "the app applies that search to list_my_agents's search unless you give your own",
    );
  });

  it("maps the Topics table's Visibility to get_topics_overview, and its other columns to words", () => {
    expect(pageOrderLine(TOPICS, [], { sort: { key: 'visibility', dir: 'desc' } })).toContain(
      'read get_topics_overview, so they are the rows on screen',
    );
    const mentions = pageOrderLine(TOPICS, [], { sort: { key: 'mentions', dir: 'asc' } })!;
    expect(mentions).toContain(
      "The page lists its topics, by mentions, lowest first, as the person sorted it, an order get_topics_overview doesn't take.",
    );
    expect(mentions).toContain('read the rows page_view lists by their refs');
  });
});
