import { describe, expect, it } from 'vitest';
import { stepRecord } from './step-record';

describe('the record a read read, for its Data used chip (UX audit CH-10)', () => {
  it('names an action by its code, a report or an opportunity by its title', () => {
    expect(stepRecord('get_action', { code: 'AC-12', id: 'x' })).toBe('AC-12');
    expect(stepRecord('get_report', { title: '  Weekly   summary ' })).toBe('Weekly summary');
    expect(stepRecord('get_content_opportunity', { title: 'x'.repeat(80) })).toHaveLength(60);
  });

  it('names nothing for a read of many, or a result without a name', () => {
    expect(stepRecord('list_signals', { title: 'S-07' })).toBeNull();
    expect(stepRecord('get_action', null)).toBeNull();
    expect(stepRecord('get_action', { code: '' })).toBeNull();
    expect(stepRecord('get_report', [{ title: 'a' }])).toBeNull();
  });
});
