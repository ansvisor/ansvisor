import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { FOCUS_AREAS } from './focus';
import {
  FOCUS_SHORTCUTS,
  FOCUS_SKILLS,
  FOCUS_STARTERS,
  focusGreeting,
  focusStarters,
  inTurn,
  NO_FILL,
  skillsByFocus,
  starterWords,
} from './focus-home';
import library from './skills/library.json';

/**
 * Chat Home by focus (CHAT-24 §4): every picked area in turn, questions in
 * the workspace's own words or their general wording, a line only with
 * something true to say, and the focus's skills first in the / menu.
 */

const byFocus = messages.chatShell.home.byFocus as {
  shortcuts: Record<string, string>;
  starters: Record<string, string>;
};

describe('inTurn', () => {
  it('takes the 1st of each list, then the 2nd of each, each item once, up to the most', () => {
    expect(
      inTurn(
        [
          ['a1', 'a2', 'a3'],
          ['b1', 'a2'],
          ['c1', 'c2', 'c3'],
        ],
        6,
      ),
    ).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
    expect(inTurn([], 4)).toEqual([]);
    expect(inTurn([['x'], ['x']], 4)).toEqual(['x']);
  });
});

describe('focusStarters', () => {
  it('gives four questions with every picked area in them', () => {
    expect(focusStarters(['comp', 'brand']).map((p) => [p.area, p.starter])).toEqual([
      ['comp', 'gainedMost'],
      ['brand', 'describe'],
      ['comp', 'whyRival'],
      ['brand', 'factCheckPricing'],
    ]);
    expect(focusStarters(['pd', 'bd', 'comp']).map((p) => p.area)).toEqual([
      'pd',
      'bd',
      'comp',
      'pd',
    ]);
    expect(focusStarters([])).toEqual([]);
  });
});

describe('starterWords', () => {
  it('fills a question with the workspace’s word, or takes its general wording', () => {
    const fill = { rival: 'Kestrel CRM', topic: 'Integrations', market: null };
    expect(starterWords('whyRival', fill)).toEqual({
      key: 'whyRival',
      values: { rival: 'Kestrel CRM' },
    });
    expect(starterWords('buyersAsk', fill)).toEqual({
      key: 'buyersAsk',
      values: { topic: 'Integrations' },
    });
    expect(starterWords('rivalsInMarket', fill)).toEqual({ key: 'rivalsInMarketAny', values: {} });
    expect(starterWords('winning', NO_FILL)).toEqual({ key: 'winning', values: {} });
  });
});

describe('focusGreeting', () => {
  it('says a competitor’s rise from the first area with something to say, 3 points or more', () => {
    const rivalMove = { name: 'Kestrel CRM', points: 4 };
    expect(focusGreeting(['pd', 'comp'], { rivalMove })).toEqual({
      key: 'rivalRose',
      values: { rival: 'Kestrel CRM', points: 4 },
    });
    expect(focusGreeting(['comp'], { rivalMove: { ...rivalMove, points: 2 } })).toBeNull();
    expect(focusGreeting(['pd', 'brand'], { rivalMove })).toBeNull();
    expect(focusGreeting(['comp'], { rivalMove: null })).toBeNull();
  });
});

describe('skillsByFocus', () => {
  it('puts the picked areas’ skills first, in turn, and leaves the rest as they were', () => {
    const skills = ['winback', 'tasks', 'quality', 'faq', 'report', 'wrongclaim'].map((name) => ({
      name,
    }));
    expect(skillsByFocus(skills, ['brand', 'lead']).map((s) => s.name)).toEqual([
      'wrongclaim',
      'report',
      'winback',
      'tasks',
      'quality',
      'faq',
    ]);
    expect(skillsByFocus(skills, []).map((s) => s.name)).toEqual(skills.map((s) => s.name));
  });

  it('names only skills the library has', () => {
    const names = new Set(library.skills.map((skill) => skill.name));
    for (const area of FOCUS_AREAS) {
      for (const skill of FOCUS_SKILLS[area]) expect(names).toContain(skill);
    }
  });
});

describe('the words', () => {
  it('has a label and a message for every shortcut, and every question in both wordings', () => {
    const jobs = new Set(['tasks', 'winBack', 'publish']);
    for (const area of FOCUS_AREAS) {
      for (const shortcut of FOCUS_SHORTCUTS[area]) {
        if (jobs.has(shortcut)) continue;
        expect(byFocus.shortcuts[shortcut], shortcut).toBeTruthy();
        expect(byFocus.shortcuts[`${shortcut}Message`], shortcut).toBeTruthy();
      }
      for (const starter of FOCUS_STARTERS[area]) {
        const filled = starterWords(starter, { rival: 'R', topic: 'T', market: 'M' }).key;
        const general = starterWords(starter, NO_FILL).key;
        expect(byFocus.starters[filled], filled).toBeTruthy();
        expect(byFocus.starters[general], general).toBeTruthy();
      }
    }
  });
});
