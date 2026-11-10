/**
 * The apps Ansvisor recognises (MCP over OAuth, #2141), by the host their
 * code goes to (a dynamically registered app's redirect URI) or, for an app
 * named by its Client ID Metadata Document, its URL's host. Anyone can
 * register a client called "Claude"; only Claude receives codes at
 * claude.ai. The consent page and Settings › MCP & API Keys mark the others
 * "Not checked by Ansvisor".
 */
export const KNOWN_APPS: Readonly<Record<string, string>> = {
  'claude.ai': 'Claude',
  'chatgpt.com': 'ChatGPT',
  'platform.openai.com': 'ChatGPT',
};

/** A known app's name by its host; null for any other host. */
export function knownAppName(host: string): string | null {
  return Object.hasOwn(KNOWN_APPS, host) ? KNOWN_APPS[host] : null;
}
