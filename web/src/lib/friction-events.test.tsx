import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import {
  FRICTION_EVENTS,
  FRICTION_FLOWS,
  frictionFlow,
  trackErrorShown,
  trackUpgradeWall,
  upgradeWallReason,
  useUpgradeWallShown,
  type UpgradeWall,
} from './friction-events';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * What a person tried and couldn't do: the cancel analysis reads these
 * events by name and property, so they stay put, and carry ids only.
 */

beforeEach(() => vi.clearAllMocks());

describe('FRICTION_EVENTS', () => {
  it('keeps the names the cancel analysis reads', () => {
    expect(FRICTION_EVENTS).toEqual({
      upgradeWallShown: 'upgrade_wall_shown',
      errorShown: 'error_shown',
      flowStarted: 'flow_started',
      flowCompleted: 'flow_completed',
      flowFailed: 'flow_failed',
    });
  });

  it('keeps the flows by the same names', () => {
    expect(FRICTION_FLOWS).toEqual({
      brandAdd: 'brand_add',
      promptAdd: 'prompt_add',
      cmsConnect: 'cms_connect',
      contentGenerate: 'content_generate',
      chatAnswer: 'chat_answer',
      siteAuditRun: 'site_audit_run',
    });
  });
});

describe('the upgrade wall', () => {
  it('sends why, what was locked and where', () => {
    trackUpgradeWall({ reason: 'plan', feature: 'shopping_analytics', source: 'shopping' });
    expect(track).toHaveBeenCalledWith('upgrade_wall_shown', {
      feature: 'shopping_analytics',
      reason: 'plan',
      source: 'shopping',
    });
  });

  it('sends null for what isn’t known, and for anything that isn’t an id', () => {
    trackUpgradeWall({ reason: 'read_only' });
    trackUpgradeWall({
      reason: 'plan',
      feature: 'Adding prompts needs a plan',
      source: 'acme.com',
    });
    expect(vi.mocked(track).mock.calls).toEqual([
      ['upgrade_wall_shown', { feature: null, reason: 'read_only', source: null }],
      ['upgrade_wall_shown', { feature: null, reason: 'plan', source: null }],
    ]);
  });

  it('reads the dialog’s reasons as a wall’s', () => {
    expect(upgradeWallReason('ended')).toBe('read_only');
    expect(upgradeWallReason('trial')).toBe('read_only');
    expect(upgradeWallReason('payment_failed')).toBe('payment_failed');
    expect(upgradeWallReason('demo')).toBe('demo');
  });

  it('counts a wall shown once on mount, again when it is another, and none while hidden', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    function Wall({ wall }: { wall: UpgradeWall | null }) {
      useUpgradeWallShown(wall);
      return null;
    }
    const limit: UpgradeWall = { reason: 'plan_limit', feature: 'max_prompts', source: 'prompts' };
    await act(async () => root.render(<Wall wall={limit} />));
    // The same wall drawn again, as a new object: no second count.
    await act(async () => root.render(<Wall wall={{ ...limit }} />));
    expect(track).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Wall wall={null} />));
    expect(track).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Wall wall={limit} />));
    await act(async () => root.render(<Wall wall={{ reason: 'plan', source: 'chat' }} />));
    expect(vi.mocked(track).mock.calls).toEqual([
      ['upgrade_wall_shown', { feature: 'max_prompts', reason: 'plan_limit', source: 'prompts' }],
      ['upgrade_wall_shown', { feature: 'max_prompts', reason: 'plan_limit', source: 'prompts' }],
      ['upgrade_wall_shown', { feature: null, reason: 'plan', source: 'chat' }],
    ]);
    act(() => root.unmount());
  });
});

describe('a flow', () => {
  it('sends its name when it starts, completes and fails', () => {
    const flow = frictionFlow('brand_add');
    flow.started();
    flow.completed();
    flow.failed('plan_limit');
    expect(vi.mocked(track).mock.calls).toEqual([
      ['flow_started', { flow: 'brand_add' }],
      ['flow_completed', { flow: 'brand_add' }],
      ['flow_failed', { flow: 'brand_add', error_code: 'plan_limit' }],
    ]);
  });

  it('names the CMS of a cms_connect in each', () => {
    const flow = frictionFlow('cms_connect', { target: 'webflow' });
    flow.started();
    flow.failed('invalid');
    expect(vi.mocked(track).mock.calls).toEqual([
      ['flow_started', { flow: 'cms_connect', target: 'webflow' }],
      ['flow_failed', { flow: 'cms_connect', target: 'webflow', error_code: 'invalid' }],
    ]);
  });

  it('never sends a message as the error code', () => {
    const flow = frictionFlow('site_audit_run');
    flow.failed();
    flow.failed('Server error: 500 for https://acme.com');
    flow.failed('Failed');
    expect(vi.mocked(track).mock.calls).toEqual([
      ['flow_failed', { flow: 'site_audit_run', error_code: null }],
      ['flow_failed', { flow: 'site_audit_run', error_code: null }],
      ['flow_failed', { flow: 'site_audit_run', error_code: null }],
    ]);
  });
});

describe('an error toast', () => {
  it('sends its kind alone', () => {
    trackErrorShown();
    expect(track).toHaveBeenCalledWith('error_shown', { kind: 'toast' });
  });
});
