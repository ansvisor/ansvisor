import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { HubspotError } from './client.js';
import { AI_SOURCES } from '../ai-sources.js';
import { contactProperties } from './properties.js';
import { ensureProperties, portalLabel, readPortal } from './setup.js';

/**
 * What connecting HubSpot sets up in the brand's account (#2140): the account
 * it is, and the Ansvisor property group and properties, safe to run again.
 * Against a fake HubSpot answering in the documented shape (__fixtures__).
 */

vi.mock('../logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn() }));

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

/** A fake HubSpot: routes by `METHOD path`; a route's answer may be a function of the body. */
function fakeHubspot(routes) {
  const calls = [];
  const request = vi.fn(async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected ${method} ${path}`);
    const answer = typeof route === 'function' ? route(body) : route;
    if (answer instanceof Error) throw answer;
    return { status: 200, headers: {}, data: answer };
  });
  return { request, calls };
}

const GROUP_PATH = '/crm/v3/properties/contacts/groups/ansvisor';
const notFound = () => new HubspotError('not_found', 'GET answered 404', { status: 404 });

describe('readPortal', () => {
  it('reads the account: its Hub ID, currency, time zone and address', async () => {
    const { request } = fakeHubspot({
      'GET /account-info/v3/details': fixture('account-details'),
    });
    const portal = await readPortal(request);
    expect(portal).toEqual({
      id: 4412893,
      currency: 'USD',
      timeZone: 'Europe/Istanbul',
      uiDomain: 'app-eu1.hubspot.com',
    });
    expect(portalLabel(portal)).toBe('Hub ID 4412893');
  });

  it('refuses an answer that names no account', async () => {
    const { request } = fakeHubspot({ 'GET /account-info/v3/details': {} });
    await expect(readPortal(request)).rejects.toMatchObject({ code: 'http_error' });
  });
});

describe('ensureProperties', () => {
  it('makes the group and every property in an account that has none', async () => {
    const { request, calls } = fakeHubspot({
      [`GET ${GROUP_PATH}`]: notFound(),
      'POST /crm/v3/properties/contacts/groups': fixture('group-created'),
      'POST /crm/v3/properties/contacts/batch/read': fixture('properties-read-none'),
      'POST /crm/v3/properties/contacts/batch/create': { status: 'COMPLETE', results: [] },
    });
    const made = await ensureProperties(request);
    expect(made).toEqual({
      group: true,
      created: contactProperties().map((p) => p.name),
      updated: [],
    });
    expect(calls.find((c) => c.path.endsWith('/groups')).body).toEqual({
      name: 'ansvisor',
      label: 'Ansvisor',
      displayOrder: -1,
    });
    const create = calls.find((c) => c.path.endsWith('/batch/create'));
    expect(create.body.inputs).toEqual(contactProperties());
  });

  it('keeps what exists, and adds the AI sources the dropdown lacks', async () => {
    const existing = fixture('properties-read-older-source-list');
    const { request, calls } = fakeHubspot({
      [`GET ${GROUP_PATH}`]: { name: 'ansvisor' },
      'POST /crm/v3/properties/contacts/batch/read': existing,
      'POST /crm/v3/properties/contacts/batch/create': { status: 'COMPLETE', results: [] },
      'PATCH /crm/v3/properties/contacts/ansvisor_ai_source': {},
    });
    const made = await ensureProperties(request);
    expect(made.group).toBe(false);
    // The two that exist aren't made again.
    expect(made.created).toEqual([
      'ansvisor_ai_first_visit_at',
      'ansvisor_ai_converted_at',
      'ansvisor_brand',
      'ansvisor_brand_id',
    ]);
    expect(made.updated).toEqual(['ansvisor_ai_source']);
    const patch = calls.find((c) => c.method === 'PATCH').body.options;
    // HubSpot's own two first, untouched, then every other source, in order.
    expect(patch.slice(0, 2)).toEqual(existing.results[0].options);
    expect(patch.map((o) => o.value)).toEqual(AI_SOURCES.map((s) => s.key));
    expect(patch.map((o) => o.displayOrder)).toEqual(AI_SOURCES.map((_, i) => i));
  });

  it('does nothing more in an account that is set up', async () => {
    const all = contactProperties();
    const { request, calls } = fakeHubspot({
      [`GET ${GROUP_PATH}`]: { name: 'ansvisor' },
      'POST /crm/v3/properties/contacts/batch/read': { status: 'COMPLETE', results: all },
    });
    expect(await ensureProperties(request)).toEqual({ group: false, created: [], updated: [] });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('takes a group made meanwhile, and says when HubSpot refuses a property', async () => {
    const { request } = fakeHubspot({
      [`GET ${GROUP_PATH}`]: notFound(),
      'POST /crm/v3/properties/contacts/groups': new HubspotError('conflict', '409', {
        status: 409,
      }),
      'POST /crm/v3/properties/contacts/batch/read': fixture('properties-read-none'),
      'POST /crm/v3/properties/contacts/batch/create': fixture('properties-create-archived'),
    });
    await expect(ensureProperties(request)).rejects.toMatchObject({
      code: 'conflict',
      category: 'OBJECT_ALREADY_EXISTS',
    });
  });

  it("passes HubSpot's other refusals on", async () => {
    const { request } = fakeHubspot({
      [`GET ${GROUP_PATH}`]: new HubspotError('scopes', '403', { status: 403 }),
    });
    await expect(ensureProperties(request)).rejects.toMatchObject({ code: 'scopes' });
  });
});
