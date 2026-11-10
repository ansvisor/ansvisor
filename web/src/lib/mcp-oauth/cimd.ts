import { supabaseAdmin } from '@/lib/supabase/admin';
import { cleanClientName, type OAuthClient } from './clients';
import { MAX_REDIRECT_URIS, checkRedirectUri } from './redirect-uris';
import { SafeFetchError, fetchPublicJson } from './safe-fetch';

/**
 * Client ID Metadata Documents (MCP authorization spec 2025-11-25, "SHOULD";
 * draft-ietf-oauth-client-id-metadata-document): an app names itself by an
 * https URL that serves a JSON document about it, instead of registering.
 * Claude and ChatGPT use one when the authorization server advertises
 * `client_id_metadata_document_supported` with "none" among its token
 * endpoint auth methods, and Claude Code always has one. Dynamic
 * registration stays for the apps that don't.
 *
 * The spec's rules for the server, each kept here:
 *   * the document is fetched safely (safe-fetch.ts: public addresses only,
 *     no redirects, 5 s, 10 KB);
 *   * its `client_id` must equal the URL exactly — a trailing slash too;
 *   * the request's redirect URI must be one it lists (redirect-uris.ts);
 *   * it is cached by its Cache-Control, from five minutes to a day;
 *   * the consent page names the app by the URL's host, not by the name the
 *     document gives itself (consent.ts).
 * A CIMD app is a public client: "none", PKCE only. A document asking for
 * another way to authenticate is refused.
 */

const MIN_CACHE_SECONDS = 5 * 60;
const MAX_CACHE_SECONDS = 24 * 60 * 60;
const DEFAULT_CACHE_SECONDS = 60 * 60;

/** Whether a client id is a document's URL: https, a path, no query, fragment, credentials or dot segments. */
export function isClientIdUrl(value: string): boolean {
  if (!value.startsWith('https://') || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || url.search) return false;
  if (url.port && url.port !== '443') return false;
  if (url.pathname === '/' || url.pathname === '') return false;
  // The URL as written must be the URL as parsed: no ./ or ../ the parser removed.
  return !/\/\.{1,2}(\/|$)/.test(value.slice(url.origin.length));
}

export type DocumentProblem =
  | 'not_an_object'
  | 'client_id_mismatch'
  | 'redirect_uris'
  | 'auth_method'
  | 'grant_types'
  | 'response_types';

export interface ClientDocument {
  clientName: string | null;
  redirectUris: string[];
  metadata: Record<string, unknown>;
}

/** A fetched document checked against the URL it came from. */
export function readClientDocument(
  url: string,
  body: unknown,
): { ok: true; document: ClientDocument } | { ok: false; problem: DocumentProblem } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, problem: 'not_an_object' };
  }
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== url) return { ok: false, problem: 'client_id_mismatch' };
  const uris = doc.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length < 1 ||
    uris.length > MAX_REDIRECT_URIS ||
    uris.some((uri) => typeof uri !== 'string' || checkRedirectUri(uri) !== null)
  ) {
    return { ok: false, problem: 'redirect_uris' };
  }
  const method = doc.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') return { ok: false, problem: 'auth_method' };
  const grants = doc.grant_types ?? ['authorization_code'];
  if (
    !Array.isArray(grants) ||
    !grants.includes('authorization_code') ||
    grants.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')
  ) {
    return { ok: false, problem: 'grant_types' };
  }
  const types = doc.response_types ?? ['code'];
  if (!Array.isArray(types) || types.some((type) => type !== 'code')) {
    return { ok: false, problem: 'response_types' };
  }
  const metadata = Object.fromEntries(
    Object.entries(doc)
      .filter(([key]) =>
        [
          'client_uri',
          'logo_uri',
          'tos_uri',
          'policy_uri',
          'software_id',
          'software_version',
        ].includes(key),
      )
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 2000) : null]),
  );
  return {
    ok: true,
    document: {
      clientName: cleanClientName(doc.client_name),
      redirectUris: [...new Set(uris as string[])],
      metadata,
    },
  };
}

const COLUMNS =
  'client_id, kind, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash, metadata_expires_at';

type CachedClient = OAuthClient & { metadata_expires_at: string | null };

/**
 * The app a document URL names: from the cache while it is fresh, else
 * fetched, checked and cached again. Null when it can't be fetched or
 * doesn't check out: the authorization request ends on Ansvisor's page.
 */
export async function resolveCimdClient(
  url: string,
  fetchJson: typeof fetchPublicJson = fetchPublicJson,
): Promise<OAuthClient | null> {
  if (!isClientIdUrl(url)) return null;
  const cached = await supabaseAdmin
    .from('oauth_clients')
    .select(COLUMNS)
    .eq('client_id', url)
    .maybeSingle();
  if (cached.error) throw new Error(`Could not read the client: ${cached.error.message}`);
  const row = cached.data as CachedClient | null;
  if (row && row.kind !== 'cimd') return null;
  if (row?.metadata_expires_at && Date.parse(row.metadata_expires_at) > Date.now()) {
    const { metadata_expires_at: _expires, ...client } = row;
    return client;
  }

  let fetched: Awaited<ReturnType<typeof fetchPublicJson>>;
  try {
    fetched = await fetchJson(url);
  } catch (err) {
    console.error(
      '[mcp-oauth] Could not fetch a client metadata document:',
      err instanceof SafeFetchError ? err.code : err,
    );
    return null;
  }
  const read = readClientDocument(url, fetched.body);
  if (!read.ok) {
    console.error('[mcp-oauth] A client metadata document was refused:', read.problem);
    return null;
  }

  const now = Date.now();
  const seconds = Math.min(
    MAX_CACHE_SECONDS,
    Math.max(MIN_CACHE_SECONDS, fetched.maxAge ?? DEFAULT_CACHE_SECONDS),
  );
  const values = {
    client_name: read.document.clientName,
    redirect_uris: read.document.redirectUris,
    metadata: read.document.metadata,
    metadata_fetched_at: new Date(now).toISOString(),
    metadata_expires_at: new Date(now + seconds * 1000).toISOString(),
  };
  const saved = row
    ? await supabaseAdmin.from('oauth_clients').update(values).eq('client_id', url)
    : await supabaseAdmin.from('oauth_clients').insert({
        ...values,
        client_id: url,
        kind: 'cimd',
        token_endpoint_auth_method: 'none',
        client_secret_hash: null,
      });
  if (saved.error) throw new Error(`Could not keep the client: ${saved.error.message}`);
  return {
    client_id: url,
    kind: 'cimd',
    client_name: read.document.clientName,
    redirect_uris: read.document.redirectUris,
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
  };
}
