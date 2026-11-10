import { isIP } from 'node:net';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The log of MCP over OAuth (oauth_events, 00510): a connection made, refused
 * or ended, and a code or refresh token used twice. Not every refresh: that
 * would be noise. The address is shortened (IPv4 to its /24, IPv6 to its
 * /48) and the user agent cut to 200 characters. Writing it never fails the
 * request it describes.
 */

export type OAuthEventName =
  | 'client_registered'
  | 'consent_granted'
  | 'consent_denied'
  | 'blocked_trial'
  | 'blocked_ended'
  | 'code_reuse'
  | 'refresh_reuse'
  | 'revoked_by_person'
  | 'revoked_by_client'
  | 'revoked_member_left';

export interface OAuthEvent {
  event: OAuthEventName;
  organizationId?: string | null;
  userId?: string | null;
  grantId?: string | null;
  clientId?: string | null;
  /** The request it happened on, for its address and user agent. */
  req?: Request;
}

/** The caller's address as the platform's proxy reports it. */
export function requestIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || req.headers.get('x-real-ip')?.trim() || '';
  return isIP(ip) ? ip : null;
}

/** An address shortened to its network: 203.0.113.0/24, 2001:db8:1::/48. */
export function shortIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(ip) !== 6) return null;
  const [head, tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0');
  const groups = [...headGroups, ...zeros, ...tailGroups].slice(0, 3);
  return `${groups.map((group) => group.replace(/^0+(?=.)/, '').toLowerCase()).join(':')}::/48`;
}

export async function logOAuthEvent(entry: OAuthEvent): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('oauth_events').insert({
      event: entry.event,
      organization_id: entry.organizationId ?? null,
      user_id: entry.userId ?? null,
      grant_id: entry.grantId ?? null,
      client_id: entry.clientId?.slice(0, 2000) ?? null,
      ip: entry.req ? shortIp(requestIp(entry.req)) : null,
      user_agent: entry.req?.headers.get('user-agent')?.slice(0, 200) ?? null,
    });
    if (error) console.error('[mcp-oauth] Could not log', entry.event, error.message);
  } catch (err) {
    console.error('[mcp-oauth] Could not log', entry.event, err);
  }
}
