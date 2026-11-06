// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { isTourTopic, TOUR_PAGES, TOUR_TOPICS, tourFocusOf, tourTopicsOfPath } from './tour';

/**
 * The product tour's topics (owner decision 2026-11-06): the welcome card's
 * chips in their order, each with its name and a page of the app.
 */

const APP = path.join(__dirname, '../../app/[locale]/(dashboard)');

/** A folder and the (group) folders inside it, which add nothing to the address. */
function withGroups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const groups = readdirSync(dir)
    .filter((entry) => /^\(.+\)$/.test(entry))
    .flatMap((entry) => withGroups(path.join(dir, entry)));
  return [dir, ...groups];
}

/** Whether a route is a page of the app: a folder per segment, or a [param] folder, through (group) folders. */
function pageExists(route: string): boolean {
  let dirs = [APP];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap(withGroups).flatMap((dir) => {
      const named = path.join(dir, segment);
      const params = readdirSync(dir)
        .filter((entry) => /^\[[^.\]]+\]$/.test(entry))
        .map((entry) => path.join(dir, entry));
      return [...(existsSync(named) ? [named] : []), ...params];
    });
  }
  return dirs.flatMap(withGroups).some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

describe('the tour topics', () => {
  it('run in the order the welcome card shows them', () => {
    expect(TOUR_TOPICS).toEqual(['visibility', 'prompts', 'positions', 'content', 'connections']);
  });

  it('each have a name and open a page of the app', () => {
    for (const topic of TOUR_TOPICS) {
      expect(messages.chatTour.topics[topic], topic).toBeTruthy();
      expect(pageExists(TOUR_PAGES[topic]), TOUR_PAGES[topic]).toBe(true);
    }
  });

  it('tells a topic from anything else', () => {
    expect(isTourTopic('content')).toBe(true);
    expect(isTourTopic('everything')).toBe(false);
    expect(isTourTopic(null)).toBe(false);
  });
});

describe('the page a tour turn is about', () => {
  it('reads the topics of each page and the pages under it', () => {
    expect(tourTopicsOfPath('/dashboard/insights')).toEqual(['visibility']);
    expect(tourTopicsOfPath('/dashboard/mentions')).toEqual(['visibility']);
    expect(tourTopicsOfPath('/dashboard/citations/domains')).toEqual(['visibility']);
    expect(tourTopicsOfPath('/dashboard/prompts/tracked')).toEqual(['prompts', 'positions']);
    expect(tourTopicsOfPath('/dashboard/prompts')).toEqual(['prompts', 'positions']);
    expect(tourTopicsOfPath('/dashboard/content/plan')).toEqual(['content']);
    expect(tourTopicsOfPath('/dashboard/content/editor/d1')).toEqual([]);
    expect(tourTopicsOfPath('/dashboard/settings/integrations')).toEqual(['connections']);
    expect(tourTopicsOfPath('/dashboard/settings/team')).toEqual([]);
    expect(tourTopicsOfPath('/dashboard/insightsx')).toEqual([]);
    expect(tourTopicsOfPath('/dashboard/audit')).toEqual([]);
  });

  it('focuses the latest turn about the page, never another page’s', () => {
    const turns = [
      { topic: 'visibility' as const, question: 0 },
      { topic: 'prompts' as const, question: 2 },
      { topic: 'visibility' as const, question: 4 },
      { topic: 'content' as const, question: 6 },
    ];
    // Back on Visibility from the menu after Content: its own latest turn.
    expect(tourFocusOf({ pathname: '/dashboard/insights', turns, current: 'content' })).toEqual({
      kind: 'turn',
      topic: 'visibility',
      question: 4,
    });
    // Tracked Prompts is Prompts' and Positions': the latest of either.
    expect(
      tourFocusOf({ pathname: '/dashboard/prompts/tracked', turns, current: 'content' }),
    ).toEqual({ kind: 'turn', topic: 'prompts', question: 2 });
    expect(
      tourFocusOf({
        pathname: '/dashboard/prompts/tracked',
        turns: [...turns, { topic: 'positions', question: 8 }],
        current: 'positions',
      }),
    ).toEqual({ kind: 'turn', topic: 'positions', question: 8 });
  });

  it('offers to explain a topic page not explained yet, and keeps the newest turn elsewhere', () => {
    const turns = [{ topic: 'visibility' as const, question: 0 }];
    expect(
      tourFocusOf({ pathname: '/dashboard/settings/integrations', turns, current: 'visibility' }),
    ).toEqual({ kind: 'unexplained', topic: 'connections' });
    // The first of the page's topics not explained.
    expect(tourFocusOf({ pathname: '/dashboard/prompts', turns, current: 'visibility' })).toEqual({
      kind: 'unexplained',
      topic: 'prompts',
    });
    expect(tourFocusOf({ pathname: '/dashboard/audit', turns, current: 'visibility' })).toEqual({
      kind: 'newest',
      topic: 'visibility',
    });
    // A tour chat from before its turns were marked: nothing about this page in focus.
    expect(tourFocusOf({ pathname: '/dashboard/content', turns: [], current: 'content' })).toEqual({
      kind: 'unexplained',
      topic: 'content',
    });
  });
});
