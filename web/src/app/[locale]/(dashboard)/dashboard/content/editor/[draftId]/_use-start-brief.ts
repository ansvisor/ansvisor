'use client';

import { useEffect, useRef } from 'react';
import { START_BRIEF_PARAM } from '@/lib/content/drafts';
import { readUrlParam, writeUrlParams } from '@/lib/url-state';

/**
 * A draft the Action Center's Start now just wrote (AC-ACTION-PLAN spec §10
 * item 5) opens with `?brief=build`: its brief is built once, as the Next
 * step basket's Build brief builds it (its progress on the agent card, its
 * AI usage as always), and only when the draft has none yet. The address
 * loses the param as it is read, so a reload or a shared link builds
 * nothing. `hasBrief` is null until the brief is read.
 */
export function useStartBrief({
  hasBrief,
  build,
}: {
  hasBrief: boolean | null;
  build: () => void;
}): void {
  // Whether the address asked for it: read once, after mount.
  const asked = useRef<boolean | null>(null);
  useEffect(() => {
    asked.current = readUrlParam(START_BRIEF_PARAM) === 'build';
    if (asked.current) writeUrlParams({ [START_BRIEF_PARAM]: null });
  }, []);
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  useEffect(() => {
    if (!asked.current || hasBrief === null) return;
    asked.current = false;
    if (!hasBrief) buildRef.current();
  }, [hasBrief]);
}
