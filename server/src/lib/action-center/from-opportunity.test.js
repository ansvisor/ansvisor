import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { assetTasks, combinedTasks, opportunityAssets } = await import('./from-opportunity.js');
const { getTask } = await import('./tasks/registry.js');

const owned = (decision) => ({ type: 'blog_post', channel: 'owned', decision });

describe('assetTasks', () => {
  it('writes a new page from a brief when there is none', () => {
    expect(assetTasks(owned('create'))).toEqual([
      'create_content_brief',
      'create_content_draft',
      'add_internal_links',
      'publish_content',
      'validate_ai_visibility',
    ]);
  });

  it('works on the existing page otherwise', () => {
    expect(assetTasks(owned('expand'))[0]).toBe('optimize_content');
    expect(assetTasks(owned('refresh'))[0]).toBe('refresh_content');
  });

  it('takes earned work through outreach', () => {
    expect(assetTasks({ type: 'backlink', channel: 'earned', decision: 'create' })).toEqual([
      'identify_target_sources',
      'prepare_outreach',
      'execute_outreach',
      'track_third_party_status',
      'validate_third_party_citation',
    ]);
  });

  it('uses only tasks the library has', () => {
    const all = combinedTasks([
      owned('create'),
      owned('refresh'),
      owned('optimize'),
      { type: 'third_party_article', channel: 'earned', decision: 'create' },
      { type: 'backlink', channel: 'earned', decision: 'create' },
    ]);
    for (const id of all) expect(getTask(id), id).toBeTruthy();
  });
});

describe('combinedTasks', () => {
  it('lists each task once, work before checks, measurement last', () => {
    const tasks = combinedTasks([
      owned('optimize'),
      { type: 'third_party_article', channel: 'earned', decision: 'create' },
    ]);
    expect(tasks).toEqual([
      'optimize_content',
      'add_internal_links',
      'publish_content',
      'identify_target_sources',
      'prepare_contribution',
      'execute_outreach',
      'track_third_party_status',
      'validate_ai_visibility',
      'validate_third_party_presence',
      'measure_action_outcome',
    ]);
  });
});

describe('opportunityAssets', () => {
  it('gives an opportunity from before assets one, from its own fields', () => {
    expect(
      opportunityAssets({
        title: 'T',
        type: 'owned',
        decision: 'optimize',
        source_data: { targetPages: [{ url: 'u' }] },
      }),
    ).toEqual([
      {
        key: 'a1',
        type: null,
        channel: 'owned',
        decision: 'optimize',
        title: 'T',
        pages: [{ url: 'u' }],
      },
    ]);
    expect(opportunityAssets({ title: 'T', type: 'earned', source_data: {} })[0]).toMatchObject({
      channel: 'earned',
      decision: 'create',
    });
  });
});
