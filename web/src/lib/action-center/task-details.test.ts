import { describe, expect, it } from 'vitest';
import {
  TASK_DETAIL_LIMITS,
  cleanTaskDetailsEdit,
  isTaskDetailsEdit,
  parseTaskDetails,
} from './task-details';

const empty = {
  body: null,
  platform: null,
  platformLabel: null,
  sources: [],
  where: null,
  why: null,
  how: [],
  doneWhen: null,
  type: null,
  effort: null,
  role: null,
};

describe('parseTaskDetails', () => {
  it('reads a task sent from the Improve tab, which has none of the AC-004 fields', () => {
    expect(
      parseTaskDetails({
        body: 'Lead with the table.',
        platform: 'chatgpt-web',
        platformLabel: 'ChatGPT',
        sources: [{ type: 'domain', ref: 'profound.com' }],
      }),
    ).toEqual({
      ...empty,
      body: 'Lead with the table.',
      platform: 'chatgpt-web',
      platformLabel: 'ChatGPT',
      sources: [{ type: 'domain', ref: 'profound.com' }],
    });
  });

  it('reads where, why, how, done-when, type, effort and role', () => {
    expect(
      parseTaskDetails({
        where: 'acme.example/blog/best-tools',
        why: 'Cited #2 until Oct 8.',
        how: ['Add a table.', '  ', 'Update the title.'],
        doneWhen: 'Cited again on 2 of 3 platforms.',
        type: 'content',
        effort: '~2h',
        role: 'Content writer',
      }),
    ).toEqual({
      ...empty,
      where: 'acme.example/blog/best-tools',
      why: 'Cited #2 until Oct 8.',
      how: ['Add a table.', 'Update the title.'],
      doneWhen: 'Cited again on 2 of 3 platforms.',
      type: 'content',
      effort: '~2h',
      role: 'Content writer',
    });
  });

  it('ignores what is malformed rather than failing on it', () => {
    expect(
      parseTaskDetails({
        where: 'x.example',
        how: 'not a list',
        type: 'marketing',
        sources: [{ type: 'domain' }, null, 'x'],
      }),
    ).toEqual({ ...empty, where: 'x.example' });
  });

  it('is null when there is nothing to show', () => {
    expect(parseTaskDetails(null)).toBeNull();
    expect(parseTaskDetails([])).toBeNull();
    expect(parseTaskDetails('text')).toBeNull();
    expect(parseTaskDetails({ where: '  ', how: [] })).toBeNull();
  });
});

describe('cleanTaskDetailsEdit', () => {
  const edit = {
    where: '',
    why: '',
    how: [],
    doneWhen: '',
    type: null,
    effort: '',
    role: '',
  };

  it('trims, and stores a cleared field as null', () => {
    expect(
      cleanTaskDetailsEdit({ ...edit, where: '  /pricing  ', why: '   ', effort: ' ~1h ' }),
    ).toEqual({
      where: '/pricing',
      why: null,
      how: [],
      doneWhen: null,
      type: null,
      effort: '~1h',
      role: null,
    });
  });

  it('drops blank steps and keeps at most the limit', () => {
    const how = ['One', '', '  ', ...Array.from({ length: 12 }, (_, i) => `Step ${i}`)];
    const cleaned = cleanTaskDetailsEdit({ ...edit, how });
    expect(cleaned.how[0]).toBe('One');
    expect(cleaned.how).toHaveLength(TASK_DETAIL_LIMITS.steps);
  });

  it('cuts each field to its length and refuses an unknown type', () => {
    const cleaned = cleanTaskDetailsEdit({
      ...edit,
      why: 'x'.repeat(1000),
      type: 'marketing' as never,
    });
    expect(cleaned.why).toHaveLength(TASK_DETAIL_LIMITS.why);
    expect(cleaned.type).toBeNull();
  });
});

describe('isTaskDetailsEdit', () => {
  const edit = {
    where: '/pricing',
    why: '',
    how: ['Add a table.'],
    doneWhen: '',
    type: 'content',
    effort: '',
    role: '',
  };

  it('accepts what the form sends', () => {
    expect(isTaskDetailsEdit(edit)).toBe(true);
    expect(isTaskDetailsEdit({ ...edit, type: null })).toBe(true);
  });

  it('refuses a malformed edit before anything reads it', () => {
    expect(isTaskDetailsEdit(null)).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, how: 'Add a table.' })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, how: [1] })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, where: null })).toBe(false);
    expect(isTaskDetailsEdit({ ...edit, type: 'marketing' })).toBe(false);
  });
});
