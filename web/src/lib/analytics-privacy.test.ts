import type { CaptureResult, CapturedNetworkRequest } from 'posthog-js';
import { describe, expect, it } from 'vitest';
import {
  REPLAY_OPTIONS,
  scrubEvent,
  scrubNetworkRequest,
  scrubUrl,
  stripInviteParams,
} from './analytics-privacy';

const INVITE_SIGN_UP =
  'https://app.ansvisor.com/en/sign-up?invite=tok_123&email=cal%40acme.test&next=%2Fen%2Finvite%2Ftok_123';

describe('scrubUrl', () => {
  it("takes an invitation's token and address out of the sign-up link", () => {
    const clean = scrubUrl(INVITE_SIGN_UP);
    expect(clean).toBe('https://app.ansvisor.com/en/sign-up?next=%2Fen%2Finvite%2F%5Btoken%5D');
    expect(clean).not.toContain('tok_123');
    expect(clean).not.toContain('acme');
  });

  it("hides the token in an invitation page's path", () => {
    expect(scrubUrl('https://app.ansvisor.com/en/invite/tok_123')).toBe(
      'https://app.ansvisor.com/en/invite/[token]',
    );
    expect(scrubUrl('/en/invite/tok_123')).toBe('/en/invite/[token]');
  });

  it('drops sign-in codes and tokens from the query and the fragment', () => {
    expect(scrubUrl('https://app.ansvisor.com/en/reset-password?code=c0de&lang=en')).toBe(
      'https://app.ansvisor.com/en/reset-password?lang=en',
    );
    expect(
      scrubUrl('https://app.ansvisor.com/#access_token=a1&refresh_token=r1&type=recovery'),
    ).toBe('https://app.ansvisor.com/#type=recovery');
    expect(scrubUrl('/en/sign-in?token=t&token_hash=h')).toBe('/en/sign-in');
  });

  it('gives back anything else as it was', () => {
    for (const value of [
      'https://app.ansvisor.com/en/dashboard/prompts?tab=topics',
      '/en/dashboard/content#section-2',
      '$direct',
      '',
    ]) {
      expect(scrubUrl(value)).toBe(value);
    }
  });
});

describe('scrubEvent', () => {
  it("cleans the event's URLs and the person's, and leaves other properties alone", () => {
    const event = {
      uuid: 'u1',
      event: '$pageview',
      properties: {
        $current_url: INVITE_SIGN_UP,
        $pathname: '/en/invite/tok_123',
        $referrer: 'https://mail.example/?token=abc',
        $prev_pageview_pathname: '/en/invite/tok_123',
        $set_once: { $initial_current_url: INVITE_SIGN_UP },
        plan: 'growth',
        count: 3,
      },
      $set: { $current_url: INVITE_SIGN_UP },
      $set_once: { $initial_referrer: 'https://app.ansvisor.com/en/invite/tok_123' },
    } as unknown as CaptureResult;

    const sent = JSON.stringify(scrubEvent(event));
    expect(sent).not.toContain('tok_123');
    expect(sent).not.toContain('acme');
    expect(sent).not.toContain('abc');
    expect(event.properties.$pathname).toBe('/en/invite/[token]');
    expect(event.properties.plan).toBe('growth');
    expect(event.properties.count).toBe(3);
  });

  it("cleans the addresses a heatmap's points are kept by, and merges those that meet", () => {
    const click = { x: 10, y: 20, target_fixed: false, type: 'click' };
    const move = { x: 1, y: 2, target_fixed: false, type: 'mousemove' };
    const event = {
      event: '$$heatmap',
      properties: {
        $current_url: 'https://app.ansvisor.com/sign-up?invite=tok&email=a%40b.co',
        $heatmap_data: {
          'https://app.ansvisor.com/sign-up?invite=tok&email=a%40b.co': [click],
          'https://app.ansvisor.com/sign-up?invite=other': [move],
          'https://app.ansvisor.com/invite/abc123': [click],
          'https://app.ansvisor.com/dashboard/insights': [move],
        },
      },
    } as unknown as CaptureResult;
    const scrubbed = scrubEvent(event)!;
    expect(scrubbed.properties.$heatmap_data).toEqual({
      'https://app.ansvisor.com/sign-up': [click, move],
      'https://app.ansvisor.com/invite/[token]': [click],
      'https://app.ansvisor.com/dashboard/insights': [move],
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/=tok|=other|a%40b|abc123/);
  });

  it('passes a dropped event on', () => {
    expect(scrubEvent(null)).toBeNull();
  });
});

describe('scrubNetworkRequest', () => {
  it("cleans a replay's URL and never keeps a request's bodies", () => {
    const request = {
      name: 'https://app.ansvisor.com/en/invite/tok_123',
      method: 'POST',
      status: 200,
      requestBody: '{"name":"laptop"}',
      responseBody: '{"key":{"token":"ak_live_secret"}}',
    } as CapturedNetworkRequest;

    const kept = scrubNetworkRequest(request);
    expect(kept.name).toBe('https://app.ansvisor.com/en/invite/[token]');
    expect(kept.method).toBe('POST');
    expect(kept.status).toBe(200);
    expect(kept.requestBody).toBeUndefined();
    expect(kept.responseBody).toBeUndefined();
  });
});

describe('REPLAY_OPTIONS', () => {
  it("masks every input, leaves ph-no-capture out, and keeps the project's text masking", () => {
    expect(REPLAY_OPTIONS.maskAllInputs).toBe(true);
    expect(REPLAY_OPTIONS.blockClass).toBe('ph-no-capture');
    expect(REPLAY_OPTIONS.maskTextClass).toBe('ph-mask');
    expect(REPLAY_OPTIONS.maskCapturedNetworkRequestFn).toBe(scrubNetworkRequest);
    // A selector set in code would replace the PostHog project's own.
    expect(REPLAY_OPTIONS).not.toHaveProperty('maskTextSelector');
    expect(REPLAY_OPTIONS).not.toHaveProperty('blockSelector');
  });
});

describe('stripInviteParams', () => {
  it("takes an invitation's token, address and way back out of the address bar", () => {
    expect(stripInviteParams(INVITE_SIGN_UP)).toBe('/en/sign-up');
  });

  it('keeps the rest of the query', () => {
    expect(
      stripInviteParams(
        'https://app.ansvisor.com/en/sign-up?invite=t&email=a%40b.test&plan=growth',
      ),
    ).toBe('/en/sign-up?plan=growth');
    expect(
      stripInviteParams(
        'https://app.ansvisor.com/en/sign-up?email=a%40b.test&next=%2Fen%2Fdashboard%2Fchat',
      ),
    ).toBe('/en/sign-up?next=%2Fen%2Fdashboard%2Fchat');
  });

  it('changes nothing on a sign-up without an invitation', () => {
    expect(stripInviteParams('https://app.ansvisor.com/en/sign-up')).toBeNull();
    expect(
      stripInviteParams('https://app.ansvisor.com/en/sign-up?next=%2Fen%2Fdashboard%2Fchat'),
    ).toBeNull();
  });
});
