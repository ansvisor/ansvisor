import { describe, expect, it } from 'vitest';
import { getFaviconUrl } from './favicon';

describe('getFaviconUrl', () => {
  it("uses Google's favicon service for a real site", () => {
    expect(getFaviconUrl('https://acme.com/pricing', 64)).toBe(
      'https://www.google.com/s2/favicons?domain=acme.com&sz=64',
    );
  });

  it("gives the demo brand's made-up sites the logos the app ships", () => {
    expect(getFaviconUrl('brewline.example')).toBe('/demo/logos/brewline.svg');
    expect(getFaviconUrl('https://www.northboundroasters.example/blog')).toBe(
      '/demo/logos/northboundroasters.svg',
    );
  });

  it('gives any other .example site a letter mark, never a request out', () => {
    const url = getFaviconUrl('quietcorner.example');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('>Q</text>');
  });
});
