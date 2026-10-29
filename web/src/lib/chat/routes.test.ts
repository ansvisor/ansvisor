// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hrefWithFilters, routeById, routeRegistry, routeRequest } from './routes';

/** Chat's "Go to a page" (CHAT-19 §2, W1-28): the route registry and the rules-based router. */

const APP = path.resolve(__dirname, '../../app/[locale]/(dashboard)');

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
function pageExists(route: string): boolean {
  let dirs = [APP];
  for (const segment of route.split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const params = readdirSync(dir)
        .filter((entry) => /^\[[^.\]]+\]$/.test(entry))
        .map((entry) => path.join(dir, entry));
      const named = path.join(dir, segment);
      return [...(existsSync(named) ? [named] : []), ...params];
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

describe('routeRegistry', () => {
  const routes = routeRegistry();

  it('comes from the live sidebar and Settings, named as the sidebar names them', () => {
    expect(routeById('insights')).toMatchObject({ name: 'Brand Visibility', section: null });
    expect(routeById('/dashboard/prompts/tracked')).toMatchObject({
      name: 'Tracked Prompts',
      section: 'Prompts',
    });
    expect(routeById('content/plan')).toMatchObject({
      section: 'Content',
      requiredFeature: 'content_optimization',
    });
    expect(routeById('settings/ai-providers')).toMatchObject({
      name: 'AI Providers',
      section: 'Settings',
    });
    // Chat doesn't open itself.
    expect(routeById('agent')).toBeUndefined();
  });

  it('points every route at a page of the app, once', () => {
    expect(routes.filter((r) => !pageExists(r.href)).map((r) => r.href)).toEqual([]);
    const hrefs = routes.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('sets only the filters a page keeps, with the values it takes', () => {
    const insights = routeById('insights')!;
    expect(hrefWithFilters(insights, { range: '30d', platform: 'perplexity-web' })).toEqual({
      href: '/dashboard/insights?range=30d&model=perplexity-web',
      applied: [
        { key: 'range', value: '30d' },
        { key: 'platform', value: 'perplexity-web' },
      ],
    });
    expect(hrefWithFilters(routeById('competitors')!, { range: '24h', platform: 'x' }).href).toBe(
      '/dashboard/competitors',
    );
  });
});

describe('routeRequest', () => {
  const to = (text: string) => {
    const routed = routeRequest(text);
    return routed ? hrefWithFilters(routed.route, routed.filters).href : null;
  };

  it('opens the page with its filters set, from plain words', () => {
    expect(to('Open Visibility for Perplexity, last 30 days')).toBe(
      '/dashboard/insights?range=30d&model=perplexity-web',
    );
    expect(to('Take me to Competitors')).toBe('/dashboard/competitors');
    expect(to('Open Settings › AI Providers')).toBe('/dashboard/settings/ai-providers');
    expect(to('go to tracked prompts for the last 7 days')).toBe(
      '/dashboard/prompts/tracked?range=7d',
    );
    expect(to('Show me citations from ChatGPT all time')).toBe(
      '/dashboard/citations?preset=all&platform=chatgpt-web',
    );
    expect(to('open the content library')).toBe('/dashboard/content/library');
    expect(to('Open Prompts › Query Fan-outs')).toBe('/dashboard/prompts/fan-outs');
  });

  it('takes the longest name it finds: Prompts Insights over Insights', () => {
    expect(to('open prompt insights')).toBe('/dashboard/prompts/insights');
  });

  it('leaves to the model what it did not fully understand', () => {
    // A filter it can't set.
    expect(to('Show me the Content drafts under Quality 60')).toBeNull();
    // A filter the page doesn't keep.
    expect(to('Open Competitors for Perplexity')).toBeNull();
    // A question, or no navigation verb.
    expect(to('Why did my visibility drop?')).toBeNull();
    expect(to('visibility for perplexity')).toBeNull();
    expect(to('open the thing I looked at yesterday')).toBeNull();
  });
});
