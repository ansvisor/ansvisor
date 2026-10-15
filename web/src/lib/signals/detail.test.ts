import { describe, expect, it } from 'vitest';
import type { Signal } from './map';
import { NO_WHERE } from './where';
import { signalChange, signalDetailForApi, signalLinks, signalWhereFields } from './detail';

const signal = (over: Partial<Signal>): Signal => ({
  id: 's1',
  category: 'visibility',
  kind: 'platform_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-08T10:53:00+00:00',
  lastDetectedAt: '2026-10-09T10:53:00+00:00',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {},
  kpiKeys: [],
  actionId: null,
  where: NO_WHERE,
  ...over,
});

const platformDrop = signal({
  payload: {
    entity: 'platforms',
    platform: 'gemini-web',
    targets: [{ id: 'gemini-web', label: 'gemini-web' }],
  },
  previousValue: 34,
  currentValue: 18,
  changeValue: -16,
  where: { platforms: ['gemini-web'], regions: [], topics: [] },
});

const lostCitation = signal({
  category: 'citation',
  kind: 'lost_citations',
  payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
  where: { platforms: ['chatgpt-web', 'gemini-web'], regions: ['US'], topics: ['Coffee'] },
});

const source = signal({
  category: 'competitor',
  kind: 'competitor_winning_source',
  payload: {
    entity: 'sources',
    domain: 'yotpo.com',
    prompts: 6,
    results: 251,
    targets: [{ id: 'yotpo.com', label: 'yotpo.com' }],
  },
  previousValue: 0,
  currentValue: 251,
  changeValue: 167,
});

describe('signalChange', () => {
  it('gives a week-over-week change its two windows', () => {
    expect(signalChange(platformDrop)).toEqual({
      period: 'week_over_week',
      figures: [
        { metric: 'mention_rate', role: 'before', value: 34 },
        { metric: 'mention_rate', role: 'after', value: 18 },
      ],
    });
  });

  it("names a source's three counts instead of a before and an after", () => {
    expect(signalChange(source)).toEqual({
      period: 'last_7_days',
      figures: [
        { metric: 'answers_citing', role: 'total', value: 251 },
        { metric: 'answers_citing', role: 'naming_you', value: 0 },
        { metric: 'answers_citing', role: 'competitors_only', value: 167 },
      ],
    });
  });

  it('compares inside one window, naming what is compared', () => {
    expect(
      signalChange(
        signal({
          kind: 'country_gap',
          payload: { entity: 'regions', region: 'TR', bestRegion: 'US' },
          previousValue: 22.5,
          currentValue: 3.1,
        }),
      )?.figures,
    ).toEqual([
      { metric: 'mention_rate', role: 'best', value: 22.5, subject: 'US', subjectType: 'location' },
      { metric: 'mention_rate', role: 'this', value: 3.1, subject: 'TR', subjectType: 'location' },
    ]);
    expect(
      signalChange(
        signal({
          category: 'competitor',
          kind: 'competitor_leads',
          payload: { competitorName: 'Profound' },
          previousValue: 40,
          currentValue: 160,
        }),
      )?.figures,
    ).toEqual([
      {
        metric: 'mentions',
        role: 'competitor',
        value: 160,
        subject: 'Profound',
        subjectType: 'competitor',
      },
      { metric: 'mentions', role: 'you', value: 40 },
    ]);
  });

  it('adds what fell beside AI sessions on a cross-channel finding', () => {
    const figures = signalChange(
      signal({
        category: 'traffic',
        kind: 'cross_channel_risk',
        payload: { entity: 'pages', targets: [{ id: 'site' }], clicksBefore: 900, clicksNow: 600 },
        previousValue: 120,
        currentValue: 80,
      }),
    )?.figures;
    expect(figures?.map((f) => `${f.metric}:${f.role}:${f.value}`)).toEqual([
      'ai_sessions:before:120',
      'ai_sessions:after:80',
      'search_clicks:before:900',
      'search_clicks:after:600',
    ]);
  });

  it("counts a competitor topic finding's prompts", () => {
    expect(
      signalChange(
        signal({
          category: 'competitor',
          kind: 'competitor_topic_lead',
          payload: { entity: 'topics', topicName: 'AEO', targets: [{ id: 't1', label: 'AEO' }] },
          currentValue: 12,
        }),
      ),
    ).toEqual({
      period: 'last_7_days',
      figures: [{ metric: 'prompts', role: 'total', value: 12 }],
    });
  });

  it('has nothing to say when the row records no figures', () => {
    expect(signalChange(lostCitation)).toBeNull();
  });
});

describe('signalWhereFields', () => {
  const keys = (s: Signal) => signalWhereFields(s).map((f) => `${f.key}${f.value ? '' : ' (n/a)'}`);

  it('asks a lost citation which page was cited and who is cited now', () => {
    expect(keys(lostCitation)).toEqual([
      'prompt',
      'topic',
      'trackedOn',
      'trackedIn',
      'lostUrl (n/a)',
      'citedNow (n/a)',
    ]);
    expect(signalWhereFields(lostCitation)[0].value).toEqual({
      type: 'prompt',
      id: 'p1',
      text: 'Best coffee subscription?',
    });
  });

  it("lists a competitor source's open questions as not available", () => {
    expect(keys(source)).toEqual([
      'competitor (n/a)',
      'domain',
      'platforms (n/a)',
      'competitorPositions (n/a)',
      'winningSources (n/a)',
    ]);
  });

  it("names a platform signal's scope and platform", () => {
    expect(keys(platformDrop)).toEqual(['scope', 'platforms']);
  });

  it('says a brand-wide finding covers every platform rather than none', () => {
    expect(
      signalWhereFields(
        signal({ kind: 'sharp_drop', previousValue: 24, currentValue: 15, payload: {} }),
      ),
    ).toEqual([
      { key: 'scope', value: { type: 'scope', scope: 'all_prompts' } },
      { key: 'platforms', value: { type: 'all_platforms' } },
    ]);
  });

  it("reads a technical finding's failed checks as its evidence", () => {
    const audit = signal({
      category: 'technical',
      kind: 'outdated_content',
      payload: {
        entity: 'pages',
        targets: [{ id: '/pricing', page: '/pricing', checks: ['dateModified', 'freshness'] }],
      },
      currentValue: 1,
    });
    expect(signalWhereFields(audit)).toEqual([
      { key: 'pages', value: { type: 'list', items: ['/pricing'], total: 1 } },
      { key: 'crawlers', value: null },
      {
        key: 'evidence',
        value: { type: 'list', items: ['dateModified', 'freshness'], total: 2 },
      },
    ]);
  });
});

describe('signalLinks', () => {
  it('points at the answers behind a signal, or the page that shows its source', () => {
    expect(signalLinks(lostCitation)).toEqual([
      { kind: 'prompt_answers', href: '/dashboard/prompts/p1' },
    ]);
    expect(signalLinks(source)).toEqual([{ kind: 'citations', href: '/dashboard/citations' }]);
    expect(
      signalLinks(
        signal({ kind: 'topic_drop', payload: { entity: 'topics', targets: [{ id: 't1' }] } }),
      ),
    ).toEqual([{ kind: 'topic', href: '/dashboard/topics/t1' }]);
    // Several prompts are each linked in Where; the evidence link is the list.
    expect(
      signalLinks(
        signal({
          kind: 'high_demand_gap',
          payload: { entity: 'prompts', targets: [{ id: 'p1' }, { id: 'p2' }] },
        }),
      ),
    ).toEqual([{ kind: 'prompts', href: '/dashboard/prompts' }]);
  });
});

describe('signalDetailForApi', () => {
  it('returns the same detail with snake_case keys, units and named platforms', () => {
    const detail = signalDetailForApi({ ...lostCitation, actionId: 'a1' }, [
      { id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' },
    ]);
    expect(detail.where).toEqual({
      prompt: { id: 'p1', text: 'Best coffee subscription?' },
      topic: 'Coffee',
      tracked_on: [
        { slug: 'chatgpt-web', name: 'ChatGPT' },
        { slug: 'gemini-web', name: 'Gemini' },
      ],
      tracked_in: [{ code: 'US', name: 'United States' }],
      lost_url: null,
      cited_now: null,
    });
    expect(detail.change).toBeNull();
    expect(detail.evidence).toEqual({
      first_detected_at: '2026-10-08T10:53:00+00:00',
      last_detected_at: '2026-10-09T10:53:00+00:00',
      links: [{ kind: 'prompt_answers', path: '/dashboard/prompts/p1' }],
    });
    expect(detail.used_by_actions).toHaveLength(1);
    expect(signalDetailForApi(platformDrop, []).change?.figures[0]).toEqual({
      metric: 'mention_rate',
      role: 'before',
      value: 34,
      unit: 'percent',
      subject: null,
      subject_type: null,
    });
  });
});
