'use client';

import { useEffect, useRef } from 'react';
import posthog from 'posthog-js';

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
 */
export function PostHogProvider() {
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: false,
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
