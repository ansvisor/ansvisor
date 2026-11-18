import { describe, expect, it } from 'vitest';
import type { TrafficLog } from '@/lib/actions/traffic';
import { trafficChatView } from './_chat-view';

/**
 * What Chat's side panel sees of AI Referral Traffic beyond its range and
 * platform (the owner's plan of 2026-11-16, item 8): the visit list's
 * search, the visits on screen and how many match.
 */

const visit = (id: string, url: string, sourcePlatform: string | null): TrafficLog => ({
  id,
  brandId: 'b1',
  url,
  referrer: null,
  sourcePlatform,
  country: 'US',
  language: 'en',
  screen: null,
  createdAt: '2026-11-15T10:00:00Z',
  pageviews: 1,
});

describe('trafficChatView', () => {
  it('tells the search, and once read the visits on screen with how many match', () => {
    expect(
      trafficChatView(' pricing ', {
        logs: [
          visit('v1', 'https://acme.example/pricing', 'chatgpt.com'),
          visit('v2', 'https://acme.example/pricing?ref=x', null),
        ],
        total: 57,
      }),
    ).toEqual({
      search: 'pricing',
      rows: [
        { ref: 'v1', label: 'https://acme.example/pricing · ChatGPT' },
        { ref: 'v2', label: 'https://acme.example/pricing?ref=x' },
      ],
      total: 57,
    });
  });

  it('sends nothing while the visits are read and nothing is searched', () => {
    expect(trafficChatView('', null)).toBeUndefined();
    expect(trafficChatView('x', null)).toEqual({ search: 'x' });
  });
});
