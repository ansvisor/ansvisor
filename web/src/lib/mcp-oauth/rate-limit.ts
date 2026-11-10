import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Fixed-window rate limits for the OAuth endpoints, counted in Postgres
 * (oauth_rate_hit, 00510) so every serverless instance shares them. A
 * platform rule in front (Vercel Firewall) is the outer layer. A count that
 * can't be read lets the request through, logged: a database hiccup must
 * not lock every app out of signing in, and the endpoints' secrets are too
 * long to guess either way.
 */
export async function rateHit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc('oauth_rate_hit', {
      p_key: key.slice(0, 200),
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) throw new Error(error.message);
    return data !== false;
  } catch (err) {
    console.error('[mcp-oauth] Could not count a rate limit, letting the request through:', err);
    return true;
  }
}
