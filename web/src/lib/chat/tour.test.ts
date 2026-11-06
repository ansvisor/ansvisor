// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { isTourTopic, TOUR_PAGES, TOUR_TOPICS } from './tour';

/**
 * The product tour's topics (owner decision 2026-11-06): the welcome card's
 * chips in their order, each with its name and a page of the app.
 */

const APP = path.join(__dirname, '../../app/[locale]/(dashboard)');

/** Whether a route is a page of the app: a folder per segment, or a [param] folder. */
function pageExists(route: string): boolean {
  let dirs = [APP];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const named = path.join(dir, segment);
      const params = readdirSync(dir)
        .filter((entry) => /^\[[^.\]]+\]$/.test(entry))
        .map((entry) => path.join(dir, entry));
      return [...(existsSync(named) ? [named] : []), ...params];
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
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
