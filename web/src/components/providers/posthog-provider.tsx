'use client';

import { useEffect, useRef } from 'react';
import posthog from 'posthog-js';
import { REPLAY_OPTIONS, scrubEvent } from '@/lib/analytics-privacy';

/**
 * Initialise PostHog once on mount when the env key is configured.
 *
 * Behaviour:
 *  - If NEXT_PUBLIC_POSTHOG_KEY is empty/undefined, this component renders
 *    nothing and PostHog never touches the page — true zero-overhead for
 *    self-hosted deployments.
 *  - If the key is set, PostHog initialises with autocapture disabled (we
 *    capture explicit events from code so what we track is auditable) and
 *    is exposed on window for the analytics.ts wrapper.
 *  - Secrets stay out of events and replays (analytics-privacy.ts): inputs
 *    are always masked, `ph-no-capture` elements are left out, and URLs lose
 *    invite tokens, addresses and sign-in codes before they are sent.
 *  - Heatmaps are on: where people click (rage clicks and clicks that do
 *    nothing included), move and scroll, as points on each page, with no
 *    element's text. Dead clicks aren't sent as events of their own, which
 *    would carry the clicked element's text; set here, so the PostHog
 *    project can't change either.
 */
export function PostHogProvider() {
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: false,
      enable_heatmaps: true,
      capture_dead_clicks: false,
      disable_session_recording: false,
      session_recording: REPLAY_OPTIONS,
      before_send: scrubEvent,
      persistence: 'localStorage+cookie',
      person_profiles: 'identified_only',
      loaded: (instance) => {
        window.__ansvisor_posthog__ = instance;
      },
    });

    initialised.current = true;
  }, []);

  return null;
}
