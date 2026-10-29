/**
 * The demo brand's made-up sites (`.example` is reserved, so no favicon
 * service knows them): their logos ship with the app. A `.example` site
 * without one gets a letter mark in the app's own colours.
 */
const DEMO_LOGOS = new Set([
  'brewline',
  'northboundroasters',
  'kettleandcrate',
  'morningritual',
  'daybreakbeans',
  'roastnotes',
  'dailybrewnews',
  'cupcompare',
  'brewersforum',
  'beanbulletin',
]);

function demoLogoUrl(host: string): string {
  const name = host.replace(/^www\./, '').split('.')[0];
  if (DEMO_LOGOS.has(name)) return `/demo/logos/${name}.svg`;
  const letter = (name[0] ?? '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#44403c"/><text x="32" y="33" fill="#fafaf9" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Returns a high-quality favicon URL for a given domain
 * using Google's public favicon service.
 */
export function getFaviconUrl(domain: string, size: number = 128): string {
  const clean = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();
  if (!clean) return '';
  if (clean.endsWith('.example')) return demoLogoUrl(clean);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=${size}`;
}
