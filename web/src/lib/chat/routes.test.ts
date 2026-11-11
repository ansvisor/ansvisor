// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hrefWithFilters, routeById, routeRegistry, routeRequest } from './routes';
import { pageExists } from '@/lib/app-pages';

/** Chat's "Go to a page" (CHAT-19 §2, W1-28): the route registry and the rules-based router. */

describe('routeRegistry', () => {
  const routes = routeRegistry({ cloud: true });

  it('comes from the live sidebar and Settings, named as the sidebar names them', () => {
    expect(routeById('insights')).toMatchObject({ name: 'Visibility', section: null });
    expect(routeById('/dashboard/prompts/tracked')).toMatchObject({
      name: 'Tracked Prompts',
      section: 'Prompts',
    });
    expect(routeById('content/plan')).toMatchObject({
      section: 'Content',
      requiredFeature: 'content_optimization',
    });
    expect(routeById('settings/ai-providers', routes)).toMatchObject({
      name: 'AI Providers',
      section: 'Settings',
    });
    expect(routeById('action-center/signals')).toMatchObject({
      name: 'Signals',
      section: 'Action Center',
    });
    expect(routeById('competitors')).toMatchObject({ requiredFeature: 'competitor_tracking' });
    // Chat doesn't open itself; Agent Center, gated as Chat is, it does.
    expect(routeById('agent')).toBeUndefined();
    expect(routeById('agents')).toMatchObject({
      name: 'Agent Center',
      section: null,
      requiredFeature: 'ai_agent',
    });
  });

  // Visibility's tabs (the owner's mockup): "Go to a page" and
  // open_page name Mentions and Citations under it, at their tabs' routes.
  it('names Visibility’s Mentions and Citations tabs under it', () => {
    expect(routeById('mentions')).toMatchObject({
      href: '/dashboard/mentions',
      name: 'Mentions',
      section: 'Visibility',
    });
    expect(routeById('citations')).toMatchObject({
      href: '/dashboard/citations',
      name: 'Citations',
      section: 'Visibility',
    });
    // The Overview is the group's own address: listed once, as Visibility.
    expect(routes.filter((r) => r.href === '/dashboard/insights')).toHaveLength(1);
    expect(routeRequest('open visibility mentions', routes)?.route.href).toBe(
      '/dashboard/mentions',
    );
    // Its name until 2026-11-06 still opens it.
    expect(routeRequest('open brand visibility', routes)?.route.href).toBe('/dashboard/insights');
    expect(routeRequest('open citations', routes)?.route.href).toBe('/dashboard/citations');
  });

  it('lists only the Settings sections this install shows: a self-hosted one has no Billing or AI Providers', () => {
    const selfHosted = routeRegistry({ cloud: false });
    expect(routeById('settings/billing', selfHosted)).toBeUndefined();
    expect(routeById('settings/ai-providers', selfHosted)).toBeUndefined();
    expect(routeById('settings/team', selfHosted)).toBeDefined();
    expect(routeById('settings/billing', routes)).toBeDefined();
  });

  it('opens only pages of the app, whatever address it is asked for', () => {
    expect(routes.every((r) => r.href.startsWith('/dashboard'))).toBe(true);
    for (const address of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '../login']) {
      expect(routeById(address, routes)).toBeUndefined();
    }
  });

  it('points every route at a page of the app, once', () => {
    expect(routes.filter((r) => !pageExists(r.href)).map((r) => r.href)).toEqual([]);
    const hrefs = routes.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // Ads (ADS-01), in development: Chat opens it only where its page is there.
  it('opens Ads only with Ads on (ADS_ENABLED), after AI Referral Traffic', () => {
    expect(routeById('ads', routes)).toBeUndefined();
    expect(routeRequest('open ads', routes)).toBeNull();
    const withAds = routeRegistry({ cloud: true, ads: true });
    expect(routeById('ads', withAds)).toMatchObject({
      href: '/dashboard/ads',
      name: 'Ads',
      section: null,
    });
    expect(routeById('ads', withAds)?.requiredFeature).toBeUndefined();
    expect(routeRequest('open ads', withAds)?.route.href).toBe('/dashboard/ads');
    const ids = withAds.map((r) => r.id);
    expect(ids.indexOf('ads')).toBe(ids.indexOf('traffic') + 1);
    expect(withAds.filter((r) => !pageExists(r.href))).toEqual([]);
    // The rest of the registry is the same either way.
    expect(withAds.filter((r) => r.id !== 'ads')).toEqual(routes);
  });

  // The simplified layout (SIMPLE_NAV), being built: Chat opens Today only
  // where its page is there.
  it('opens Action Center › Today only with SIMPLE_NAV on, first of the Action Center’s pages', () => {
    const off = routeRegistry({ cloud: true, simpleNav: false });
    expect(routeById('action-center/today', off)).toBeUndefined();
    expect(routeRequest('open today', off)).toBeNull();
    const on = routeRegistry({ cloud: true, simpleNav: true });
    expect(routeById('action-center/today', on)).toMatchObject({
      href: '/dashboard/action-center/today',
      name: 'Today',
      section: 'Action Center',
    });
    expect(routeRequest('open today', on)?.route.href).toBe('/dashboard/action-center/today');
    expect(routeRequest('take me to action center › today', on)?.route.href).toBe(
      '/dashboard/action-center/today',
    );
    // A page's filters still win over "today" as a range word.
    expect(routeRequest('open citations for today', on)).toMatchObject({
      route: { href: '/dashboard/citations' },
      filters: { range: '24h' },
    });
    expect(on.filter((r) => !pageExists(r.href))).toEqual([]);
    const hrefs = on.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(off).toEqual(routes);
  });

  // The simplified menu (SIMPLE_NAV): its pages in its order, the Action
  // Center's tabs under it, Agents among them; the same pages either way.
  it('reads the simplified menu with SIMPLE_NAV on: the same pages, the tabs under the Action Center', () => {
    const off = routeRegistry({ cloud: true, simpleNav: false });
    const on = routeRegistry({ cloud: true, simpleNav: true });
    expect(routeById('agents', off)).toMatchObject({ name: 'Agent Center', section: null });
    expect(routeById('agents', on)).toMatchObject({
      href: '/dashboard/agents',
      name: 'Agents',
      section: 'Action Center',
      requiredFeature: 'ai_agent',
    });
    for (const id of ['action-center/actions', 'action-center/signals', 'action-center/history']) {
      expect(routeById(id, on)).toMatchObject({ section: 'Action Center' });
    }
    // KPIs, no tab, is still a page Chat opens.
    expect(routeById('action-center/kpis', on)).toMatchObject({ name: 'KPIs' });
    // Its old name still opens it, as "my agents" does.
    expect(routeRequest('open agent center', on)?.route.href).toBe('/dashboard/agents');
    expect(routeRequest('open my agents', on)?.route.href).toBe('/dashboard/agents');
    const ids = on.map((r) => r.id);
    expect(ids.indexOf('prompts')).toBeLessThan(ids.indexOf('insights'));
    expect(ids.indexOf('action-center/today')).toBe(ids.indexOf('action-center') + 1);
    // Today and the Actions tab are the pages added; none goes.
    expect(new Set(on.map((r) => r.href))).toEqual(
      new Set([
        ...off.map((r) => r.href),
        '/dashboard/action-center/today',
        '/dashboard/action-center/actions',
      ]),
    );
    // "Actions" opens the Actions tab with it on, the Action Center (Actions) with it off.
    expect(routeRequest('open actions', on)?.route.href).toBe('/dashboard/action-center/actions');
    expect(routeRequest('open actions', off)?.route.href).toBe('/dashboard/action-center');
    expect(routeRequest('open action center', on)?.route.href).toBe('/dashboard/action-center');
    expect(on.filter((r) => !pageExists(r.href))).toEqual([]);
  });

  it('sets only the filters a page keeps, with the values it takes', () => {
    const insights = routeById('insights')!;
    const citations = routeById('citations')!;
    expect(hrefWithFilters(citations, { range: '30d', platform: 'gemini-web' })).toEqual({
      href: '/dashboard/citations?preset=30d&platform=gemini-web',
      applied: [
        { key: 'range', value: '30d' },
        { key: 'platform', value: 'gemini-web' },
      ],
    });
    // Insights' `model` filter holds the answers' model slugs, not platform
    // ids: a platform id there would open an empty page.
    expect(hrefWithFilters(insights, { range: '30d', platform: 'chatgpt-web' })).toEqual({
      href: '/dashboard/insights?range=30d',
      applied: [{ key: 'range', value: '30d' }],
    });
    expect(hrefWithFilters(routeById('competitors')!, { range: '24h', platform: 'x' }).href).toBe(
      '/dashboard/competitors',
    );
    // A platform the pages don't filter by isn't set.
    expect(hrefWithFilters(insights, { platform: 'javascript:alert(1)' }).href).toBe(
      '/dashboard/insights',
    );
  });
});

describe('routeRequest', () => {
  const cloud = routeRegistry({ cloud: true });
  const to = (text: string) => {
    const routed = routeRequest(text, cloud);
    return routed ? hrefWithFilters(routed.route, routed.filters).href : null;
  };

  it('opens the page with its filters set, from plain words', () => {
    expect(to('Open Visibility for the last 30 days')).toBe('/dashboard/insights?range=30d');
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
    expect(to('open Agent Center')).toBe('/dashboard/agents');
    expect(to('take me to my agents')).toBe('/dashboard/agents');
  });

  it('takes the longest name it finds: Prompts Insights over Insights', () => {
    expect(to('open prompt insights')).toBe('/dashboard/prompts/insights');
    expect(to('open content plan')).toBe('/dashboard/content/plan');
  });

  it('leaves two pages of the same name to the model', () => {
    // Content › Plan, or Billing's plan; a self-hosted install has no Billing.
    expect(to('open plan')).toBeNull();
    expect(routeRequest('open plan', routeRegistry({ cloud: false }))?.route.id).toBe(
      'content/plan',
    );
    // Visibility's address, or Prompts › Insights.
    expect(to('open insights')).toBeNull();
  });

  it('opens no address it was given, only pages it knows', () => {
    expect(to('open //evil.com')).toBeNull();
    expect(to('go to javascript:alert(1)')).toBeNull();
    expect(to('take me to https://evil.com/dashboard/insights')).toBeNull();
  });

  it('leaves to the model what it did not fully understand', () => {
    // A filter it can't set.
    expect(to('Show me the Content drafts under Quality 60')).toBeNull();
    // A filter the page doesn't keep.
    expect(to('Open Competitors for Gemini')).toBeNull();
    expect(to('Open Visibility for Gemini, last 30 days')).toBeNull();
    // A question, or no navigation verb.
    expect(to('Why did my visibility drop?')).toBeNull();
    expect(to('visibility for gemini')).toBeNull();
    expect(to('open the thing I looked at yesterday')).toBeNull();
  });
});
