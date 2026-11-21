import { describe, expect, it } from 'vitest';
import { rankWithYou } from './grid-rank';

type C =
  | { name: string; score: number | null; visiblePrompts: number }
  | { name: string; none: true };

const items: C[] = [
  { name: 'Otterly', score: 31, visiblePrompts: 40 },
  { name: 'Semrush', score: 62, visiblePrompts: 80 },
  { name: 'Profound', score: 48, visiblePrompts: 12 },
  { name: 'Scrunch', score: 70, visiblePrompts: 3 },
  { name: 'Peec', none: true },
];
const statsOf = (c: C) => ('none' in c ? null : c);
const names = (entries: ReturnType<typeof rankWithYou<C>>) =>
  entries.map((e) => `${e.rank ?? '-'}:${e.item?.name ?? 'You'}${e.lowSample ? ' (low)' : ''}`);

describe('the Competitors grid by Visibility score, You in its place (UX audit CP-06)', () => {
  it('ranks highest first with You among them, then low samples and no data unranked', () => {
    const entries = rankWithYou(items, statsOf, (c) => c.name, { score: 55, visiblePrompts: 60 });
    expect(names(entries)).toEqual([
      '1:Semrush',
      '2:You',
      '3:Profound',
      '4:Otterly',
      '-:Scrunch (low)',
      '-:Peec',
    ]);
  });

  it('puts You first on a tie, and last with no score yet', () => {
    expect(
      names(
        rankWithYou(items.slice(0, 2), statsOf, (c) => c.name, { score: 62, visiblePrompts: 30 }),
      ),
    ).toEqual(['1:You', '2:Semrush', '3:Otterly']);
    expect(names(rankWithYou(items.slice(0, 2), statsOf, (c) => c.name, null))).toEqual([
      '1:Semrush',
      '2:Otterly',
      '-:You',
    ]);
  });
});
