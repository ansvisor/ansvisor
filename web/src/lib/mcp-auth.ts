import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const API_KEY_PREFIX = 'ans_';
export const API_KEY_DISPLAY_PREFIX_LEN = 12;

export function generateApiKey(): { token: string; hash: string; prefix: string } {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const prefix = token.slice(0, API_KEY_DISPLAY_PREFIX_LEN);
  return { token, hash, prefix };
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface McpAuthContext {
  userId: string;
  email: string | null;
  organizationId: string | null;
  apiKeyId: string;
}

/**
 * Resolve the bearer token on a request into a user/org context.
 *
 * Accepts only Ansvisor API keys (prefix `ans_`) — not Supabase session JWTs.
 * MCP endpoints are intended to be hit by long-lived external clients, so we
 * intentionally don't fall back to the dashboard's session cookie.
 */
export async function authenticateMcpRequest(
  req: Request,
): Promise<McpAuthContext | NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!token || !token.startsWith(API_KEY_PREFIX)) {
    return NextResponse.json(
      { error: 'Missing or malformed API key' },
      { status: 401 },
    );
  }

  const hash = hashApiKey(token);

  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error || !key || key.revoked_at) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  // Resolve the owning user + their organization so handlers don't have to.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', key.user_id)
    .maybeSingle();

  // Best-effort touch — failing here shouldn't block the request.
  supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(() => {});

  const {
    data: { user },
  } = await supabaseAdmin.auth.admin.getUserById(key.user_id);

  return {
    userId: key.user_id,
    email: user?.email ?? null,
    organizationId: profile?.organization_id ?? null,
    apiKeyId: key.id,
  };
}
