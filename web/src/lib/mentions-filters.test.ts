import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MENTIONS_FILTERS,
  mentionsStateParams,
  readMentionsState,
  type MentionsFilters,
} from './mentions-filters';

const read = (query: string) => readMentionsState(new URLSearchParams(query));

describe('readMentionsState', () => {
  it('opens on the Overview tab over 30 days with no filters', () => {
    expect(read('')).toEqual({ tab: 'overview', filters: DEFAULT_MENTIONS_FILTERS });
  });

  it('reads every filter a shared link carries', () => {
    expect(
      read(
        'tab=mentions&range=custom&from=2026-10-01&to=2026-10-14&platform=gemini-web&region=US&topic=t1&q=integrations',
      ),
    ).toEqual({
      tab: 'mentions',
      filters: {
        range: 'custom',
        from: '2026-10-01',
        to: '2026-10-14',
        platform: 'gemini-web',
        region: 'US',
        topic: 't1',
        q: 'integrations',
      },
    });
  });

  it('falls back to the defaults on an unknown tab or range', () => {
    expect(read('tab=fact-check&range=1y')).toEqual({
      tab: 'overview',
      filters: DEFAULT_MENTIONS_FILTERS,
    });
  });

  it('ignores custom dates unless the range is custom', () => {
    expect(read('range=7d&from=2026-10-01&to=2026-10-14').filters).toMatchObject({
      range: '7d',
      from: '',
      to: '',
    });
  });
});

describe('mentionsStateParams', () => {
  it('leaves the defaults out, so the default view has a clean URL', () => {
    expect(
      Object.values(mentionsStateParams('overview', DEFAULT_MENTIONS_FILTERS)).every(
        (v) => v === null,
      ),
    ).toBe(true);
  });

  it('round-trips through the URL', () => {
    const filters: MentionsFilters = {
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-14',
      platform: 'chatgpt-web',
      region: 'GB',
      topic: 't2',
      q: 'pricing',
    };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(mentionsStateParams('perception', filters))) {
      if (v !== null) params.set(k, v);
    }
    expect(readMentionsState(params)).toEqual({ tab: 'perception', filters });
  });

  it('drops custom dates outside a custom range and trims the search', () => {
    expect(
      mentionsStateParams('overview', {
        ...DEFAULT_MENTIONS_FILTERS,
        range: '7d',
        from: '2026-10-01',
        q: '  pricing ',
      }),
    ).toMatchObject({ range: '7d', from: null, q: 'pricing' });
  });
});
