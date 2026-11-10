import { NextResponse } from 'next/server';
import {
  appRedirect,
  checkAuthorizeRequest,
  saveAuthorizationRequest,
  sweepExpiredRequests,
  type ConsentErrorCode,
} from '@/lib/mcp-oauth/authorize';
import { findClient } from '@/lib/mcp-oauth/clients';
import { mcpResourceUrl } from '@/lib/mcp-oauth/config';
import { enabledIssuer, ipKey, notFound } from '@/lib/mcp-oauth/http';
import { rateHit } from '@/lib/mcp-oauth/rate-limit';

export const dynamic = 'force-dynamic';

/** Requests to connect an address may start in ten minutes. */
const AUTHORIZE_PER_IP = 60;

/**
 * The authorization endpoint (OAuth 2.1 §4.1.1): an app sends the person
 * here to connect. The request is checked and kept, and the person goes on
 * to the consent page, which signs them in first if needed. A request whose
 * client or redirect URI doesn't check out ends on Ansvisor's own page and
 * is never sent anywhere. 404 while MCP over OAuth is off.
 */
export async function GET(req: Request) {
  const issuer = enabledIssuer();
  if (!issuer) return notFound();
  const consentPage = (query: string) =>
    NextResponse.redirect(`${issuer}/oauth/consent?${query}`, 303);
  const errorPage = (code: ConsentErrorCode) => consentPage(`error=${code}`);

  if (!(await rateHit(`authorize:${ipKey(req)}`, 600, AUTHORIZE_PER_IP))) {
    return errorPage('rate_limited');
  }

  const params = new URL(req.url).searchParams;
  try {
    const client = await findClient(params.get('client_id') ?? '');
    const check = checkAuthorizeRequest(params, client, mcpResourceUrl(issuer));
    if (!check.ok) {
      if ('page' in check) return errorPage(check.page);
      return NextResponse.redirect(
        appRedirect(
          check.redirectUri,
          issuer,
          { error: check.app, description: check.description },
          check.state,
        ),
        303,
      );
    }
    const id = await saveAuthorizationRequest(check.request);
    sweepExpiredRequests();
    return consentPage(`request=${id}`);
  } catch (err) {
    console.error('[mcp-oauth] Authorization request failed:', err);
    return errorPage('invalid_request');
  }
}
