import { PLANS } from '@/config/plans';
import { brandAccessOf, readAccessProfile } from '@/lib/brand-access';
import { planFactsFromOrgRow, planGateLock, type OrgPlanRow } from '@/lib/chat/plan-facts';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-row';
import { oauthAccessFromFacts, type OAuthMcpAccess } from '@/lib/mcp/subscription-gate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { UserRole } from '@/types';
import type { ConsentErrorCode } from './authorize';
import { knownAppName } from './known-apps';
import { isLoopbackHost, redirectHost } from './redirect-uris';
import type { McpScope } from './scopes';

/**
 * What the consent page shows (MCP over OAuth, #2141; the approved mockup's
 * screens 2 to 6), read for the signed-in person with the service role.
 *
 *   * The app: a known app is named by where its code goes (the redirect
 *     URI's host: claude.ai, chatgpt.com), never by the name it gave itself,
 *     which an unchecked app's page quotes as its own word. Nothing else it
 *     said is shown; no logo is fetched.
 *   * The request is the person's who first opened it: someone else's
 *     account can't approve it (a link passed on, or a page forced open).
 *   * The person: their e-mail, role, workspace and plan, and the brands the
 *     connection will see (their brand access, read fresh on every call).
 *   * Whether the plan lets them connect (oauthAccessFromFacts: every paid
 *     plan; not the free trial, not an ended plan; always self-hosted), and
 *     whether its MCP changes need Growth.
 */

export interface ConsentApp {
  /** A known app's name, or the name an unchecked app gave itself (null when none). */
  name: string | null;
  host: string;
  recognised: boolean;
  /** It sends the person back to this computer (127.0.0.1, localhost). */
  loopback: boolean;
}

export type ConsentAccess = OAuthMcpAccess | 'no_workspace';

export interface ConsentView {
  requestId: string;
  app: ConsentApp;
  email: string;
  role: UserRole | null;
  isAdmin: boolean;
  workspace: { name: string; planName: string } | null;
  brands: { all: true; count: number } | { all: false; names: string[] } | null;
  access: ConsentAccess;
  /** What the app asked for; the person may untick changes. */
  scopes: McpScope[];
  /** On a paid plan below Growth: MCP reads, and its changes are refused. */
  writesNeedGrowth: boolean;
}

export type ConsentState =
  | { kind: 'error'; code: ConsentErrorCode }
  | { kind: 'sign_in'; requestId: string }
  | { kind: 'ready'; view: ConsentView };

export interface PendingRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: McpScope[];
  state: string | null;
  resource: string;
  user_id: string | null;
  expires_at: string;
  client_name: string | null;
  client_kind: 'dcr' | 'cimd';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The app as the page names it. A registered app by where its code goes; an
 * app known by its metadata document by that document's host (the spec:
 * the client_id URL's host, not the name the document gives itself), which
 * vouches for its redirect URIs.
 */
export function appOf(
  clientName: string | null,
  redirectUri: string,
  client?: { kind: 'dcr' | 'cimd'; clientId: string },
): ConsentApp {
  const host = redirectHost(redirectUri);
  const loopback = isLoopbackHost(host);
  if (client?.kind === 'cimd') {
    const documentHost = new URL(client.clientId).hostname;
    const known = knownAppName(documentHost);
    return { name: known ?? documentHost, host, recognised: !!known, loopback };
  }
  const known = knownAppName(host);
  return {
    name: known ?? clientName,
    host,
    recognised: !!known,
    loopback,
  };
}

/** A pending request, unexpired; null when there is none. */
export async function readPendingRequest(requestId: string | null | undefined) {
  if (!requestId || !UUID.test(requestId)) return null;
  const { data, error } = await supabaseAdmin
    .from('oauth_authorization_requests')
    .select(
      'id, client_id, redirect_uri, code_challenge, scopes, state, resource, user_id, expires_at, oauth_clients!inner(client_name, kind)',
    )
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the request: ${error.message}`);
  if (!data) return null;
  type Client = { client_name: string | null; kind: 'dcr' | 'cimd' };
  const row = data as unknown as Omit<PendingRequest, 'client_name' | 'client_kind'> & {
    oauth_clients: Client | Client[];
  };
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  const client = Array.isArray(row.oauth_clients) ? row.oauth_clients[0] : row.oauth_clients;
  const { oauth_clients: _client, ...request } = row;
  return {
    ...request,
    client_name: client?.client_name ?? null,
    client_kind: client?.kind ?? 'dcr',
  } as PendingRequest;
}

/**
 * Tie a request to the person who opened it: the first signed-in person to
 * open it, atomically; anyone else is refused.
 */
export async function claimRequest(request: PendingRequest, userId: string): Promise<boolean> {
  if (request.user_id) return request.user_id === userId;
  const { data, error } = await supabaseAdmin
    .from('oauth_authorization_requests')
    .update({ user_id: userId })
    .eq('id', request.id)
    .is('user_id', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Could not keep the request: ${error.message}`);
  if (data) return true;
  const again = await readPendingRequest(request.id);
  return again?.user_id === userId;
}

export interface Person {
  id: string;
  email: string;
}

/** The workspace, plan and brands a person would connect, and whether the plan lets them. */
export async function readConnectingPerson(person: Person) {
  const profile = await readAccessProfile(person.id);
  const organizationId = profile?.organization_id ?? null;
  const role = (profile?.role as UserRole | null | undefined) ?? null;
  if (!profile || !organizationId) {
    return { organizationId: null, role, access: 'no_workspace' as const, view: null };
  }
  const [org, brandAccess, brands] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(`name, ${ORG_PLAN_COLUMNS}`)
      .eq('id', organizationId)
      .maybeSingle(),
    brandAccessOf(profile, person.id, organizationId),
    supabaseAdmin.from('brands').select('id, name').eq('organization_id', organizationId),
  ]);
  if (org.error) throw new Error(`Could not read the workspace: ${org.error.message}`);
  if (brands.error) throw new Error(`Could not read the brands: ${brands.error.message}`);
  const row = (org.data ?? null) as (OrgPlanRow & { name?: string }) | null;
  const facts = planFactsFromOrgRow(row);
  const access = oauthAccessFromFacts(facts);
  const all = (brands.data ?? []) as { id: string; name: string }[];
  return {
    organizationId,
    role,
    access,
    view: {
      workspace: { name: row?.name ?? '', planName: PLANS[facts.planId].name },
      brands:
        brandAccess === 'all'
          ? ({ all: true, count: all.length } as const)
          : ({
              all: false,
              names: all.filter((brand) => brandAccess?.includes(brand.id)).map((b) => b.name),
            } as const),
      writesNeedGrowth: access === 'ok' && !!planGateLock(facts, { minPlan: 'growth' }),
    },
  };
}

/** The consent page's state for a request and the signed-in person (null when signed out). */
export async function loadConsent(
  requestId: string | null | undefined,
  person: Person | null,
): Promise<ConsentState> {
  if (!requestId || !UUID.test(requestId)) return { kind: 'error', code: 'invalid_request' };
  const request = await readPendingRequest(requestId);
  if (!request) return { kind: 'error', code: 'expired' };
  if (!person) return { kind: 'sign_in', requestId };
  if (!(await claimRequest(request, person.id))) return { kind: 'error', code: 'other_person' };

  const connecting = await readConnectingPerson(person);
  return {
    kind: 'ready',
    view: {
      requestId,
      app: appOf(request.client_name, request.redirect_uri, {
        kind: request.client_kind,
        clientId: request.client_id,
      }),
      email: person.email,
      role: connecting.role,
      isAdmin: connecting.role === 'admin',
      workspace: connecting.view?.workspace ?? null,
      brands: connecting.view?.brands ?? null,
      access: connecting.access,
      scopes: request.scopes,
      writesNeedGrowth: connecting.view?.writesNeedGrowth ?? false,
    },
  };
}

/**
 * The app a sign-in is for, when the sign-in page was opened on the way to
 * the consent page (its `next`): the line above the form names it. Null for
 * any other sign-in, or a request that's gone.
 */
export async function appForSignIn(next: string | null | undefined): Promise<ConsentApp | null> {
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(next, 'https://app.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://app.invalid' || url.pathname !== '/oauth/consent') return null;
  try {
    const request = await readPendingRequest(url.searchParams.get('request'));
    return request
      ? appOf(request.client_name, request.redirect_uri, {
          kind: request.client_kind,
          clientId: request.client_id,
        })
      : null;
  } catch {
    return null;
  }
}
