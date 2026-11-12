import { describe, expect, it } from 'vitest';
import { actionRefHref, actionRefNo, opensOneAction, splitActionRefs } from './action-ref';

/**
 * "AC-1497" as the app shows an action's number, and the address that opens
 * it: built from the digits only, and only for a whole number in the text.
 */

const refs = (text: string) =>
  splitActionRefs(text).flatMap((part) => (typeof part === 'string' ? [] : [part.ref]));

describe('action numbers in text', () => {
  it('finds each whole AC number, in English and Turkish', () => {
    expect(splitActionRefs('1. AC-1497 – Kaybedilen mention’ları geri kazan, then AC-62.')).toEqual(
      [
        '1. ',
        { ref: 'AC-1497', href: '/dashboard/action-center/actions/AC-1497' },
        ' – Kaybedilen mention’ları geri kazan, then ',
        { ref: 'AC-62', href: '/dashboard/action-center/actions/AC-62' },
        '.',
      ],
    );
    expect(refs("AC-62'yi aç, (AC-429) ve AC-59: önce.")).toEqual(['AC-62', 'AC-429', 'AC-59']);
    expect(refs('AC-1\nAC-2')).toEqual(['AC-1', 'AC-2']);
  });

  it('leaves a near miss alone, so it never links another action', () => {
    for (const text of [
      'AC-',
      'AC-x',
      'XAC-12',
      'AC-12a',
      'AC-12ş',
      'AC-12_3',
      'AC-1.497',
      'AC-1,5',
      'AC-12-3',
      '1AC-12',
      'actions/AC-12',
      'ac-12',
      'AC-0',
      'AC-012',
      'AC-1234567890123',
    ]) {
      expect(splitActionRefs(text), text).toEqual([text]);
    }
    expect(splitActionRefs('')).toEqual([]);
  });
});

describe("an action's address", () => {
  it('is built from real digits only', () => {
    expect(actionRefHref('1497')).toBe('/dashboard/action-center/actions/AC-1497');
    for (const bad of ['', '0', '01', '12a', '1/../x', '1?x=1', '1234567890123']) {
      expect(actionRefHref(bad), bad).toBeNull();
    }
  });

  it('reads its number back from the path, and nothing else as one', () => {
    expect(actionRefNo('AC-1497')).toBe(1497);
    expect(actionRefNo('AC-999999999999')).toBe(999_999_999_999);
    for (const other of ['1497', 'ac-1497', 'AC-', 'AC-0', 'AC-1497x', 'AC-1234567890123']) {
      expect(actionRefNo(other), other).toBeNull();
    }
    expect(actionRefNo('3f6c1d2e-8b7a-4c1d-9e2f-0a1b2c3d4e5f')).toBeNull();
  });

  it('tells a link that opens one action from the Action Center’s pages', () => {
    for (const href of [
      '/dashboard/action-center/actions/AC-1497',
      '/dashboard/action-center/actions/3f6c1d2e-8b7a-4c1d-9e2f-0a1b2c3d4e5f',
      '/dashboard/action-center/actions?action=3f6c1d2e',
      '/dashboard/action-center/actions/?action=a1&brand=b1',
    ]) {
      expect(opensOneAction(href), href).toBe(true);
    }
    for (const href of [
      '/dashboard/action-center',
      '/dashboard/action-center/actions',
      '/dashboard/action-center/actions?status=new',
      '/dashboard/action-center/actions?action=',
      '/dashboard/action-center/signals?signal=s1',
      '/dashboard/action-center/actions/a1/extra',
      '/dashboard/action-center/actions/../../citations',
      '/dashboard/action-center/actionsX/a1',
      '/dashboard/citations',
      '//example.org/dashboard/action-center/actions/AC-1',
      'https://example.org/dashboard/action-center/actions/AC-1',
    ]) {
      expect(opensOneAction(href), href).toBe(false);
    }
  });
});
