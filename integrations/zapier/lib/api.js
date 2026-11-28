const DEFAULT_BASE_URL = 'https://app.ansvisor.com';

function getBaseUrl(bundle) {
  const configured = bundle && bundle.authData && bundle.authData.base_url;
  let parsed;
  try {
    parsed = new URL(configured || DEFAULT_BASE_URL);
  } catch {
    throw new Error('Enter a valid URL for the Ansvisor web app.');
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('The Ansvisor web app URL must use HTTPS (HTTP is allowed only for localhost).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The Ansvisor web app URL must not contain credentials, a query string, or a fragment.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

async function apiRequest(z, bundle, endpoint, params = {}) {
  const response = await z.request({
    method: 'GET',
    url: getBaseUrl(bundle) + '/api/v1/' + endpoint,
    params: cleanParams(params),
    headers: { Accept: 'application/json' },
  });
  if (response && typeof response.throwForStatus === 'function') {
    response.throwForStatus();
  } else if (response && response.status >= 400) {
    throw new Error('Ansvisor API request failed with status ' + response.status + '.');
  }
  if (response && response.json !== undefined) return response.json;
  if (response && typeof response.content === 'string') {
    try { return JSON.parse(response.content); }
    catch { throw new Error('Ansvisor returned an invalid JSON response.'); }
  }
  return response;
}

function requireBrandId(bundle) {
  const brandId = bundle && bundle.inputData && bundle.inputData.brand_id;
  if (typeof brandId !== 'string' || !brandId.trim()) {
    throw new Error('Choose a brand before requesting Ansvisor metrics.');
  }
  return brandId.trim();
}

async function apiWriteRequest(z, bundle, method, endpoint, body) {
  if (method !== 'POST' && method !== 'DELETE') {
    throw new Error('Only POST and DELETE are supported for Ansvisor webhook subscriptions.');
  }
  const options = {
    method,
    url: getBaseUrl(bundle) + '/api/v1/' + endpoint,
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  const response = await z.request(options);
  if (response && typeof response.throwForStatus === 'function') {
    response.throwForStatus();
  } else if (response && response.status >= 400) {
    throw new Error('Ansvisor API request failed with status ' + response.status + '.');
  }
  if (response && response.json !== undefined) return response.json;
  if (response && typeof response.content === 'string') {
    try { return JSON.parse(response.content); }
    catch { throw new Error('Ansvisor returned an invalid JSON response.'); }
  }
  return response;
}

module.exports = { DEFAULT_BASE_URL, getBaseUrl, cleanParams, apiRequest, apiWriteRequest, requireBrandId };
