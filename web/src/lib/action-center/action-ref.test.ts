import { describe, expect, it } from 'vitest';
import {
  actionCode,
  actionCodeHref,
  actionCodeNo,
  actionCodeRefNo,
  actionRef,
  actionRefHref,
  actionRefNo,
  matchesActionCode,
  opensOneAction,
  previousActionCode,
  searchedActionNo,
  splitActionRefs,
} from './action-ref';

/**
 * "AC-1497" as the app shows an action's number, and the address that opens
 * it: built from the digits only, and only for a whole number in the text.
 * A code in text links to its code's address, which never guesses between a
 * brand's code and an old number (00534); the old path keeps the old number.
 */

const refs = (text: string) =>
  splitActionRefs(text).flatMap((part) => (typeof part === 'string' ? [] : [part.ref]));

describe('an action number as the app writes it', () => {
  it('is one format for every code shown, linked or given as an example', () => {
    expect(actionRef(12)).toBe('AC-12');
    expect(actionRef('1497')).toBe('AC-1497');
    // What it writes, the text finds and links again.
    expect(refs(`Recover lost citations (${actionRef(12)})`)).toEqual([actionRef(12)]);
    expect(actionRefHref('12')).toBe(`/dashboard/action-center/actions/${actionRef(12)}`);
  });
});

describe('action numbers in text', () => {
  it('finds each whole AC number, in English and Turkish', () => {
    expect(splitActionRefs('1. AC-1497 – Kaybedilen mention’ları geri kazan, then AC-62.')).toEqual(
      [
        '1. ',
        { ref: 'AC-1497', href: '/dashboard/action-center/actions/code/AC-1497' },
        ' – Kaybedilen mention’ları geri kazan, then ',
        { ref: 'AC-62', href: '/dashboard/action-center/actions/code/AC-62' },
        '.',
      ],
    );
    expect(refs("AC-62'yi aç, (AC-429) ve AC-59: önce.")).toEqual(['AC-62', 'AC-429', 'AC-59']);
    expect(refs('AC-1\nAC-2')).toEqual(['AC-1', 'AC-2']);
    // A brand's own codes, padded to two digits (00534).
    expect(refs('AC-03, AC-09 and AC-53')).toEqual(['AC-03', 'AC-09', 'AC-53']);
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
      'AC-00',
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
    expect(actionCodeHref('03')).toBe('/dashboard/action-center/actions/code/AC-03');
    for (const bad of ['', '0', '01', '12a', '1/../x', '1?x=1', '1234567890123']) {
      expect(actionRefHref(bad), bad).toBeNull();
    }
    for (const bad of ['', '0', '00', '012', '12a', '1/../x', '1234567890123']) {
      expect(actionCodeHref(bad), bad).toBeNull();
    }
  });

  it('reads its number back from the path, and nothing else as one', () => {
    expect(actionRefNo('AC-1497')).toBe(1497);
    // A padded code is a brand's (00534), never an old number's path.
    expect(actionRefNo('AC-03')).toBeNull();
    expect(actionCodeRefNo('AC-03')).toBe(3);
    expect(actionCodeRefNo('AC-59')).toBe(59);
    expect(actionRefNo('AC-999999999999')).toBe(999_999_999_999);
    for (const other of ['1497', 'ac-1497', 'AC-', 'AC-0', 'AC-1497x', 'AC-1234567890123']) {
      expect(actionRefNo(other), other).toBeNull();
    }
    expect(actionRefNo('3f6c1d2e-8b7a-4c1d-9e2f-0a1b2c3d4e5f')).toBeNull();
  });

  it('tells a link that opens one action from the Action Center’s pages', () => {
    for (const href of [
      '/dashboard/action-center/actions/AC-1497',
      '/dashboard/action-center/actions/code/AC-03',
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
      '/dashboard/action-center/actions/code/x',
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

// The Actions list shows each action's code and its search finds the action Chat names
// (owner's feedback, 14 Nov). One helper builds the code and one matches it.
describe("an action's code", () => {
  it('is AC- and its number, whole, and reads back as the same action', () => {
    expect(actionCode({ actionNo: 251 })).toBe('AC-251');
    expect(actionCode({ actionNo: 1497 })).toBe('AC-1497');
    expect(splitActionRefs(`See ${actionCode({ actionNo: 1497 })}.`)).toEqual([
      'See ',
      { ref: 'AC-1497', href: '/dashboard/action-center/actions/code/AC-1497' },
      '.',
    ]);
  });

  it('is what a search for AC-251, ac-251 or 251 finds, and nothing near it', () => {
    const action = { actionNo: 251 };
    for (const query of ['AC-251', 'ac-251', '251', actionCode(action)]) {
      expect(matchesActionCode(action, query), query).toBe(true);
    }
    for (const query of ['25', '2510', 'AC-2510', 'AC-25', 'citations', '']) {
      expect(matchesActionCode(action, query), query).toBe(false);
    }
  });
});

describe('a search for an action number', () => {
  it('reads the number however it is typed', () => {
    for (const query of ['AC-251', 'ac-251', 'Ac-251', 'AC 251', 'AC251', '#251', '251', ' 251 ']) {
      expect(searchedActionNo(query), query).toBe(251);
    }
  });

  it('is no number for words, a near miss or no real number', () => {
    for (const query of [
      '',
      'AC-',
      'citations',
      'AC-251a',
      'AC-25 1',
      'XAC-251',
      '0',
      '0251',
      'AC-0',
    ]) {
      expect(searchedActionNo(query), query).toBeNull();
    }
  });
});

// The owner's ask (14 Nov): each brand numbers its actions from AC-01 (00534).
describe("an action's code in its brand", () => {
  it("is its brand's number, two digits at least", () => {
    expect(actionCode({ actionNo: 648, brandNo: 1 })).toBe('AC-01');
    expect(actionCode({ actionNo: 648, brandNo: 9 })).toBe('AC-09');
    expect(actionCode({ actionNo: 648, brandNo: 53 })).toBe('AC-53');
    expect(actionCode({ actionNo: 648, brandNo: 120 })).toBe('AC-120');
    expect(actionCodeNo({ actionNo: 648, brandNo: 3 })).toBe('03');
  });

  it('is its old global number until its brand is numbered', () => {
    expect(actionCode({ actionNo: 251 })).toBe('AC-251');
    expect(actionCode({ actionNo: 251, brandNo: null })).toBe('AC-251');
    expect(actionCodeNo({ actionNo: 7, brandNo: null })).toBe('7');
  });

  it('names the old code while it reads differently, for "Previously AC-648"', () => {
    expect(previousActionCode({ actionNo: 648, brandNo: 3 })).toBe('AC-648');
    expect(previousActionCode({ actionNo: 7, brandNo: 7 })).toBeNull();
    expect(previousActionCode({ actionNo: 648, brandNo: null })).toBeNull();
  });

  it('reads back as a link to the same action', () => {
    expect(refs(`See ${actionCode({ actionNo: 648, brandNo: 3 })}.`)).toEqual(['AC-03']);
    expect(refs(`See ${actionCode({ actionNo: 648 })}.`)).toEqual(['AC-648']);
  });
});

describe('a search for a brand code', () => {
  it("finds the brand's code however it is typed, and the old number earlier messages gave", () => {
    const action = { actionNo: 648, brandNo: 3 };
    for (const query of ['AC-03', 'ac-3', '03', '3', 'AC-648', actionCode(action)]) {
      expect(matchesActionCode(action, query), query).toBe(true);
    }
    for (const query of ['AC-30', 'AC-003', '64', '']) {
      expect(matchesActionCode(action, query), query).toBe(false);
    }
  });
});
