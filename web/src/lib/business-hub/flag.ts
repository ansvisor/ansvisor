/**
 * The ChatGPT Business Hub features (Businesses in ChatGPT) behind
 * BUSINESS_HUB_ENABLED, until a person with Business Hub access has checked
 * its pages, names and regions.
 *
 * Off unless "true". Read from the process's environment each time it is
 * asked, as ADS_ENABLED is (lib/ads/flag.ts): not a NEXT_PUBLIC_ variable,
 * so nothing is written into the browser's code. Server components read it
 * and hand the answer down. The API server reads the same variable the same
 * way (server/src/lib/business-hub/flag.js). Set both to the same value.
 */
export function businessHubEnabled(): boolean {
  return process.env.BUSINESS_HUB_ENABLED === 'true';
}
