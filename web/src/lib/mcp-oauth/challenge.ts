import { NextResponse } from 'next/server';
import { protectedResourceMetadataUrl } from './config';
import { MCP_SCOPES, scopeString } from './scopes';

/**
 * The MCP endpoint's answer when it can't take a request's token (RFC 6750
 * §3, MCP authorization spec 2025-11-25). A 401 starts sign-in: its
 * WWW-Authenticate names the protected resource metadata, where the app
 * finds Ansvisor's authorization server, and the scopes to ask for (both:
 * the person picks on the consent page). Claude starts sign-in only on a
 * 401 with this header; a 403 with insufficient_scope asks the person for
 * more, any other 403 is final.
 */

type ChallengeError = 'invalid_token' | 'insufficient_scope';

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '')}"`;
}

/** The WWW-Authenticate value. */
export function bearerChallenge(
  issuer: string,
  { error, description }: { error?: ChallengeError; description?: string } = {},
): string {
  const parts: string[] = [];
  if (error) parts.push(`error=${quoted(error)}`);
  if (description) parts.push(`error_description=${quoted(description)}`);
  parts.push(`resource_metadata=${quoted(protectedResourceMetadataUrl(issuer))}`);
  parts.push(`scope=${quoted(scopeString(MCP_SCOPES))}`);
  return `Bearer ${parts.join(', ')}`;
}

/** 401: no token, or one Ansvisor can't take. The body keeps the shape API-key clients read. */
export function unauthorizedWithChallenge(
  issuer: string,
  message: string,
  error?: 'invalid_token',
): NextResponse {
  return NextResponse.json(
    { error: message, ...(error ? { error_code: error } : {}) },
    {
      status: 401,
      headers: { 'WWW-Authenticate': bearerChallenge(issuer, { error, description: message }) },
    },
  );
}

/** 403: a connection that reads only, calling a tool that changes something. */
export function insufficientScope(issuer: string): NextResponse {
  const message =
    'This connection can only read. Connect again and allow changes to let it make the change.';
  return NextResponse.json(
    { error: 'insufficient_scope', message },
    {
      status: 403,
      headers: {
        'WWW-Authenticate': bearerChallenge(issuer, {
          error: 'insufficient_scope',
          description: message,
        }),
      },
    },
  );
}
