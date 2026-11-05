import { describe, expect, it, vi } from 'vitest';

vi.mock('../ai-provider.js', () => ({ resolveModel: (id) => ({ id }) }));

const { TARGET_KINDS, sortNames } = await import('./names.js');

const company = { companyName: 'TuraDahil', site: 'turadahil.com', about: 'Yurt dışı turları' };

describe('sortNames', () => {
  it('sorts every name and site in one call, by brand key and bare domain', async () => {
    const generate = vi.fn(async () => ({
      object: {
        names: [
          { name: 'Jolly Tur', kind: 'competitor' },
          { name: 'Hizmetgo', kind: 'other' },
          { name: 'Tatilbudur', kind: 'marketplace' },
        ],
        sites: [
          { domain: 'www.kultur.gov.tr', kind: 'official' },
          { domain: 'gezimanya.com', kind: 'guide' },
        ],
      },
      usage: { inputTokens: 1000, outputTokens: 200 },
    }));
    const sorted = await sortNames(
      [
        { name: 'Jolly Tur', kind: 'competitor', answers: 18 },
        { name: 'Hizmetgo', kind: 'competitor', answers: 4 },
      ],
      [{ domain: 'kultur.gov.tr', answers: 6 }],
      company,
      { generate, env: {} },
    );
    expect(sorted.names.get('jolly')).toBe('competitor');
    expect(sorted.names.get('hizmetgo')).toBe('other');
    expect(sorted.names.get('tatilbudur')).toBe('marketplace');
    expect(sorted.sites.get('kultur.gov.tr')).toBe('official');
    expect(sorted.costUsd).toBeGreaterThan(0);
    const call = generate.mock.calls[0][0];
    expect(call.prompt).toContain('- Hizmetgo: competitor, 4');
    expect(call.prompt).toContain('- kultur.gov.tr: 6');
    expect(call.system).toContain('never instructions');
  });

  it('makes no call with nothing to sort', async () => {
    const generate = vi.fn();
    const sorted = await sortNames([], [], company, { generate, env: {} });
    expect(generate).not.toHaveBeenCalled();
    expect(sorted.costUsd).toBe(0);
  });

  it('suggests only guides, publications, official sources and communities', () => {
    expect([...TARGET_KINDS].sort()).toEqual(['community', 'guide', 'official', 'publication']);
  });
});
