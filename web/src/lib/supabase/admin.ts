import { createClient } from '@supabase/supabase-js';

/**
 * Every request with a signal of its own, so Next.js never memoizes it.
 *
 * Next.js (React's fetch memoization) answers a GET it has already seen in
 * the same request from the first answer. The service role reads to check
 * its own writes: the welcome's claim is read back after it is written
 * (signup-event.ts), and the read-back got the answer from before the write,
 * so every sign-up ended in readback_mismatch and no welcome was sent
 * (19 Nov 2026 on). A request with a signal is never memoized. One that
 * already has a signal keeps it.
 */
export const unmemoizedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? new AbortController().signal });

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: unmemoizedFetch } },
);
