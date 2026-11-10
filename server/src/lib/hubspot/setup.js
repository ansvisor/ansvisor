import { HubspotError } from './client.js';
import { GROUP, contactProperties, missingOptions } from './properties.js';

/**
 * What connecting HubSpot does in the brand's account (#2140): reads which
 * HubSpot account it is (its Hub ID, currency and address), and, with the
 * person's consent to mark contacts, makes the "Ansvisor" property group
 * and its contact properties (properties.js). Both are safe to run again:
 * what exists is kept, and the AI source dropdown only gains options.
 *
 * `request` is a bound HubSpot client (client.js hubspotClient).
 */

/**
 * The HubSpot account the sign-in opens. HubSpot's account details give no
 * company name, so a card names it by its Hub ID.
 * @returns {Promise<{ id: number, currency: string|null, timeZone: string|null, uiDomain: string|null }>}
 */
export async function readPortal(request) {
  const { data } = await request({ path: '/account-info/v3/details' });
  const id = Number(data?.portalId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HubspotError('http_error', 'GET /account-info/v3/details named no account');
  }
  const text = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);
  return {
    id,
    currency: text(data.companyCurrency, 10),
    timeZone: text(data.timeZone, 64),
    uiDomain: text(data.uiDomain, 100),
  };
}

/** What a sign-in is called on a card: its Hub ID. */
export function portalLabel(portal) {
  return `Hub ID ${portal.id}`;
}

/** The group, made when it isn't there. */
async function ensureGroup(request) {
  try {
    await request({ path: `/crm/v3/properties/contacts/groups/${GROUP.name}` });
    return false;
  } catch (err) {
    if (err?.code !== 'not_found') throw err;
  }
  try {
    await request({ method: 'POST', path: '/crm/v3/properties/contacts/groups', body: GROUP });
    return true;
  } catch (err) {
    // Made meanwhile (another brand on the same account connecting).
    if (err?.code === 'conflict') return false;
    throw err;
  }
}

/**
 * Makes the group and the properties that aren't there yet, and adds the AI
 * sources the dropdown lacks. Answers what it made and changed, by name.
 * @returns {Promise<{ group: boolean, created: string[], updated: string[] }>}
 */
export async function ensureProperties(request, { properties = contactProperties() } = {}) {
  const group = await ensureGroup(request);

  const { data } = await request({
    method: 'POST',
    path: '/crm/v3/properties/contacts/batch/read',
    body: { archived: false, inputs: properties.map((p) => ({ name: p.name })) },
  });
  const found = new Map(
    (Array.isArray(data?.results) ? data.results : [])
      .filter((p) => p && typeof p.name === 'string')
      .map((p) => [p.name, p]),
  );

  const missing = properties.filter((p) => !found.has(p.name));
  if (missing.length > 0) {
    const { data: made } = await request({
      method: 'POST',
      path: '/crm/v3/properties/contacts/batch/create',
      body: { inputs: missing },
    });
    // A 207: some made, some refused (a property archived under that name).
    const refused = Array.isArray(made?.errors) ? made.errors : [];
    if (refused.length > 0) {
      throw new HubspotError('conflict', 'HubSpot refused some of the Ansvisor properties', {
        category: typeof refused[0]?.category === 'string' ? refused[0].category : undefined,
      });
    }
  }

  const updated = [];
  for (const wanted of properties) {
    const existing = found.get(wanted.name);
    if (!existing || wanted.type !== 'enumeration') continue;
    const options = Array.isArray(existing.options) ? existing.options : [];
    const added = missingOptions(options, wanted.options);
    if (added.length === 0) continue;
    await request({
      method: 'PATCH',
      path: `/crm/v3/properties/contacts/${wanted.name}`,
      body: { options: [...options, ...added] },
    });
    updated.push(wanted.name);
  }

  return { group, created: missing.map((p) => p.name), updated };
}
