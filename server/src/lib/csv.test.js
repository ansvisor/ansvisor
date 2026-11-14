import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORMULA_PREFIX_REGEX, toCsv } from './csv.js';

/** The API's CSV, cell for cell as the web's (web/src/lib/csv.ts), plus keyword columns. */
describe('toCsv', () => {
  it("guards formulas with the web's own prefixes", () => {
    const web = readFileSync(new URL('../../../web/src/lib/csv.ts', import.meta.url), 'utf8');
    const prefix = web.match(/const FORMULA_PREFIX_REGEX = \/(.+)\/;/);
    expect(prefix?.[1]).toBe(FORMULA_PREFIX_REGEX.source);
  });

  it('writes cells as the web does: quoted, doubled quotes, guarded formulas', () => {
    expect(toCsv([{ a: 'a,b', b: 'she said "hi"', c: null }], ['a', 'b', 'c'])).toBe(
      'a,b,c\n"a,b","she said ""hi""",',
    );
    expect(
      toCsv([{ f: '=1+1', p: '+cmd', m: '-calc', at: '@user', n: -3 }], ['f', 'p', 'm', 'at', 'n']),
    ).toBe("f,p,m,at,n\n'=1+1,'+cmd,'-calc,'@user,-3");
  });

  it('keeps match-type syntax in keyword cells, and guards every other cell', () => {
    const rows = [
      { Keyword: '[crm for teams]', Headline: '=HYPERLINK("x")' },
      { Keyword: '"crm for teams"', Headline: '+cmd' },
      { Keyword: '+crm +teams', Headline: '-50% today' },
      { Keyword: 'crm', Headline: '@crm' },
    ];
    expect(toCsv(rows, ['Keyword', 'Headline'], { keep: ['Keyword'] }).split('\n')).toEqual([
      'Keyword,Headline',
      `[crm for teams],"'=HYPERLINK(""x"")"`,
      `"""crm for teams""",'+cmd`,
      `+crm +teams,'-50% today`,
      `crm,'@crm`,
    ]);
  });

  it('still guards a keyword cell that could run', () => {
    const rows = ['=1+1', "+cmd|' /C calc'!A0", '-crm', '@crm', '+SUM(A1)'].map((k) => ({
      Keyword: k,
    }));
    const cells = toCsv(rows, ['Keyword'], { keep: ['Keyword'] })
      .split('\n')
      .slice(1);
    expect(cells).toEqual(["'=1+1", "'+cmd|' /C calc'!A0", "'-crm", "'@crm", "'+SUM(A1)"]);
  });
});
