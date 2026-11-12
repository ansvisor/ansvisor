import { siteConfig } from '@/config/site';
import { mcpResourceUrl } from './config';
import { MCP_SCOPES } from './scopes';

/**
 * The two discovery documents of MCP over OAuth (#2141), both served at the
 * app's root under /.well-known (next.config.ts rewrites them to /api/oauth):
 *
 *   * the MCP endpoint's protected resource metadata (RFC 9728): what the
 *     resource is, and which authorization server issues its tokens. Claude
 *     uses only the first authorization server, and `resource` must equal
 *     the URL as the person types it;
 *   * the authorization server's metadata (RFC 8414): its endpoints and what
 *     it supports. S256 only; public clients ("none") with PKCE; the `iss`
 *     of RFC 9207 in every authorization response, which ChatGPT needs for
 *     its stable redirect address and the MCP spec 2026-07-28 asks for;
 *     Client ID Metadata Documents, which Claude and ChatGPT prefer.
 */

export const OAUTH_PATHS = {
  authorize: '/api/oauth/authorize',
  token: '/api/oauth/token',
  register: '/api/oauth/register',
  revoke: '/api/oauth/revoke',
} as const;

export const TOKEN_ENDPOINT_AUTH_METHODS = [
  'none',
  'client_secret_post',
  'client_secret_basic',
] as const;
export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];

const DOCS = `${siteConfig.links.docs}/guides/mcp-server`;

export function protectedResourceMetadata(issuer: string) {
  return {
    resource: mcpResourceUrl(issuer),
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: siteConfig.name,
    resource_documentation: DOCS,
  };
}

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${issuer}${OAUTH_PATHS.token}`,
    registration_endpoint: `${issuer}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${issuer}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    code_challenge_methods_supported: ['S256'],
    // Client ID Metadata Documents (cimd.ts): with "none" above, Claude and
    // ChatGPT name themselves by URL instead of registering.
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: DOCS,
    op_policy_uri: siteConfig.legal.privacy,
    op_tos_uri: siteConfig.legal.terms,
  };
}
