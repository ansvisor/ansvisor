import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TOKEN_ENDPOINT_AUTH_METHODS, type TokenEndpointAuthMethod } from './metadata';
import { MAX_REDIRECT_URIS, checkRedirectUri, type RedirectUriProblem } from './redirect-uris';
import { CLIENT_SECRET_PREFIX, hashSecret, newClientId, newSecret, safeEqual } from './tokens';

/**
 * The apps (oauth_clients, 00510). An app registers itself (RFC 7591, open
 * registration as MCP clients expect), and is then known by its client id.
 * A public client ('none', the usual MCP client) proves itself with PKCE
 * alone; one that asks for client_secret_post or _basic gets a secret, shown
 * once and kept hashed. What it says about itself (client_name and the rest)
 * is its own word: the name is shown as such, nothing else is fetched or
 * shown. A client no person connected within a day is removed.
 */

export interface OAuthClient {
  client_id: string;
  /** 'dcr': registered here; 'cimd': known by its metadata document's URL (cimd.ts). */
  kind: 'dcr' | 'cimd';
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  client_secret_hash: string | null;
}

const CLIENT_COLUMNS =
  'client_id, kind, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash';

/** How long a client nobody connected is kept. */
export const UNUSED_CLIENT_TTL_SECONDS = 24 * 60 * 60;

/** A name as the consent page may show it: one line, no control characters, 100 characters. */
export function cleanClientName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return name || null;
}

const optionalUrl = z.string().max(2000).optional();

/** RFC 7591 §2, the parts Ansvisor reads; the rest is kept as sent, within the size limit. */
const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
    client_name: z.string().max(1000).optional(),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).max(10).optional(),
    response_types: z.array(z.string()).max(10).optional(),
    scope: z.string().max(1000).optional(),
    application_type: z.string().max(20).optional(),
    client_uri: optionalUrl,
    logo_uri: optionalUrl,
    tos_uri: optionalUrl,
    policy_uri: optionalUrl,
    software_id: z.string().max(200).optional(),
    software_version: z.string().max(100).optional(),
    contacts: z.array(z.string().max(320)).max(5).optional(),
  })
  .passthrough();

export type RegistrationProblem =
  | { error: 'invalid_redirect_uri'; uri: string; problem: RedirectUriProblem }
  | { error: 'invalid_client_metadata'; description: string };

export interface Registration {
  clientName: string | null;
  redirectUris: string[];
  method: TokenEndpointAuthMethod;
  metadata: Record<string, unknown>;
}

/** A registration request read and checked, or what's wrong with it. */
export function readRegistration(body: unknown): Registration | RegistrationProblem {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === 'redirect_uris') {
      return {
        error: 'invalid_client_metadata',
        description: `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} addresses`,
      };
    }
    return {
      error: 'invalid_client_metadata',
      description: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'not valid'}`,
    };
  }
  const value = parsed.data;
  for (const uri of value.redirect_uris) {
    const problem = checkRedirectUri(uri);
    if (problem) return { error: 'invalid_redirect_uri', uri, problem };
  }
  const method = (value.token_endpoint_auth_method ?? 'none') as TokenEndpointAuthMethod;
  if (!TOKEN_ENDPOINT_AUTH_METHODS.includes(method)) {
    return {
      error: 'invalid_client_metadata',
      description: `token_endpoint_auth_method must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`,
    };
  }
  const grants = value.grant_types ?? ['authorization_code', 'refresh_token'];
  if (
    !grants.includes('authorization_code') ||
    grants.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')
  ) {
    return {
      error: 'invalid_client_metadata',
      description: 'grant_types may be authorization_code and refresh_token only',
    };
  }
  if (value.response_types && value.response_types.some((type) => type !== 'code')) {
    return { error: 'invalid_client_metadata', description: 'response_types may be code only' };
  }
  const metadata = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !['redirect_uris', 'client_name', 'token_endpoint_auth_method'].includes(key),
    ),
  );
  if (JSON.stringify(metadata).length > 4000) {
    return { error: 'invalid_client_metadata', description: 'The registration is too large' };
  }
  return {
    clientName: cleanClientName(value.client_name),
    redirectUris: [...new Set(value.redirect_uris)],
    method,
    metadata,
  };
}

/** Save a registration; the secret, for a confidential client, is returned this once. */
export async function saveClient(
  registration: Registration,
): Promise<{ client: OAuthClient; clientSecret: string | null; createdAt: string }> {
  const clientSecret = registration.method === 'none' ? null : newSecret(CLIENT_SECRET_PREFIX);
  const { data, error } = await supabaseAdmin
    .from('oauth_clients')
    .insert({
      client_id: newClientId(),
      kind: 'dcr',
      client_name: registration.clientName,
      redirect_uris: registration.redirectUris,
      token_endpoint_auth_method: registration.method,
      client_secret_hash: clientSecret ? hashSecret(clientSecret) : null,
      metadata: registration.metadata,
    })
    .select(`${CLIENT_COLUMNS}, created_at`)
    .single();
  if (error || !data) throw new Error(`Could not save the client: ${error?.message}`);
  const { created_at: createdAt, ...client } = data as OAuthClient & { created_at: string };
  return { client, clientSecret, createdAt };
}

/** Remove the clients nobody connected within a day. Best effort. */
export function sweepUnusedClients(): void {
  const before = new Date(Date.now() - UNUSED_CLIENT_TTL_SECONDS * 1000).toISOString();
  supabaseAdmin
    .from('oauth_clients')
    .delete()
    .is('last_used_at', null)
    .lt('created_at', before)
    .then(
      () => {},
      () => {},
    );
}

export async function findClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 2000) return null;
  const { data, error } = await supabaseAdmin
    .from('oauth_clients')
    .select(CLIENT_COLUMNS)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the client: ${error.message}`);
  return (data as OAuthClient | null) ?? null;
}

/** Note that a person connected the client: it is kept from now on. Best effort. */
export function markClientUsed(clientId: string): void {
  supabaseAdmin
    .from('oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .then(
      () => {},
      () => {},
    );
}

/** The client id and secret a request presents, by HTTP Basic (RFC 6749 §2.3.1) or in the body. */
export function presentedCredentials(
  req: Request,
  form: URLSearchParams,
): { clientId: string; secret: string | null; basic: boolean } | null {
  const header = req.headers.get('authorization') ?? '';
  if (header.toLowerCase().startsWith('basic ')) {
    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    } catch {
      return null;
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    try {
      return {
        clientId: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
        secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')),
        basic: true,
      };
    } catch {
      return null;
    }
  }
  const clientId = form.get('client_id');
  if (!clientId) return null;
  return { clientId, secret: form.get('client_secret'), basic: false };
}

/**
 * The client a token or revoke request comes from, checked the way it
 * registered: a public client by its id (PKCE does the rest), a confidential
 * one by its secret too. Null refuses it (invalid_client).
 */
export async function authenticateClient(
  req: Request,
  form: URLSearchParams,
): Promise<OAuthClient | null> {
  const presented = presentedCredentials(req, form);
  if (!presented) return null;
  const client = await findClient(presented.clientId);
  if (!client) return null;
  if (client.token_endpoint_auth_method === 'none') return client;
  // Either way of sending the secret is taken, whichever the client registered.
  if (!presented.secret || !client.client_secret_hash) return null;
  return safeEqual(hashSecret(presented.secret), client.client_secret_hash) ? client : null;
}
