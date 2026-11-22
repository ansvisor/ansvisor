/**
 * The pure parts of the Ads Phase 1 probes (probe-google-ads.js,
 * probe-openai-ads.js): headers, what an answer means, and redaction. No
 * network, so they are tested (ads-probe-parts.test.js) and the probes
 * themselves never run in CI.
 *
 * The probes answer the questions the Phase 1 plan rests on before any of it
 * is built: can Ansvisor read a Google Ads account through Composio, at what
 * access level, and what does the ChatGPT Ads key read. Both are read-only: GET or Google Ads' search (a read), never a write.
 */

/** "123-456-7890" or "customers/1234567890" → "1234567890". */
export function customerId(value) {
  return String(value ?? '')
    .replace(/^customers\//, '')
    .replace(/-/g, '')
    .trim();
}

/**
 * Google Ads' own headers. Since 9 September 2026 Google issues no new
 * developer tokens and ignores the header: access sits with the Google Cloud
 * project behind the OAuth client. So the token goes on only when one is set;
 * `login-customer-id` only when the account is reached through a manager
 * account, and it is that manager's id (the customer's, not ours).
 */
export function googleAdsHeaders({ developerToken, loginCustomerId }) {
  const headers = {};
  if (developerToken) headers['developer-token'] = developerToken;
  const login = customerId(loginCustomerId);
  if (login) headers['login-customer-id'] = login;
  return headers;
}

/** The ids `customers:listAccessibleCustomers` answers. */
export function accessibleCustomerIds(data) {
  return (data?.resourceNames ?? []).map(customerId).filter(Boolean);
}

/** Every Google Ads error code in an answer, as "authorizationError.DEVELOPER_TOKEN_NOT_APPROVED". */
export function googleAdsErrorCodes(data) {
  const details = data?.error?.details ?? [];
  const codes = [];
  for (const detail of details) {
    for (const error of detail?.errors ?? []) {
      for (const [kind, code] of Object.entries(error?.errorCode ?? {})) {
        codes.push(`${kind}.${code}`);
      }
    }
  }
  return codes;
}

/** What each error the probe may meet says about the plan. */
const MEANINGS = {
  'authorizationError.DEVELOPER_TOKEN_NOT_APPROVED':
    'The developer token is at Test access: it reaches test accounts only. Apply for Basic access before real accounts can be read.',
  'authorizationError.DEVELOPER_TOKEN_PROHIBITED':
    "The developer token can't be used with this OAuth client (Google Cloud project). Use the project the token was approved for.",
  'authorizationError.USER_PERMISSION_DENIED':
    "The signed-in Google user can't reach this account directly. If it sits under a manager account, set GOOGLE_ADS_LOGIN_CUSTOMER_ID to that manager's id.",
  'authorizationError.CUSTOMER_NOT_ENABLED':
    'The account is not enabled (cancelled or not set up). Try another account.',
  'authenticationError.NOT_ADS_USER': 'The signed-in Google user has no Google Ads account.',
  'authenticationError.OAUTH_TOKEN_INVALID':
    'The OAuth token is invalid or expired. Sign in again.',
  'authenticationError.DEVELOPER_TOKEN_INVALID': 'The developer token is wrong. Check the value.',
};

/**
 * One line saying what an answer means, from its HTTP status and error codes.
 * Unknown errors say so rather than guess.
 */
export function googleAdsVerdict(status, data) {
  if (status >= 200 && status < 300) return 'OK';
  const codes = googleAdsErrorCodes(data);
  const known = codes.map((code) => MEANINGS[code]).filter(Boolean);
  if (known.length) return known.join(' ');
  const message = String(data?.error?.message ?? '');
  if (status === 404) {
    return 'Not found: the API version is probably retired. Set GOOGLE_ADS_API_VERSION to a current one (Google Ads API release notes).';
  }
  if (status === 403 && /scope/i.test(message)) {
    return 'The sign-in lacks the Google Ads scope (https://www.googleapis.com/auth/adwords). Add it to the OAuth consent / Composio auth config.';
  }
  if (status === 401) return 'Not signed in: the access token was refused.';
  return `Unexpected answer (${status})${codes.length ? `: ${codes.join(', ')}` : ''}${
    message ? `: ${message.slice(0, 200)}` : ''
  }`;
}

/**
 * Replace every secret in a text with "***", so nothing the probe prints or
 * saves carries a key or a token. Empty secrets are ignored.
 */
export function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * A short picture of a JSON answer for the ChatGPT Ads probe: its top-level
 * keys and, for a list, how many items and the first item's keys. Values are
 * never printed, only their shape.
 */
export function shapeOf(data) {
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : [];
    return { type: 'array', length: data.length, itemKeys: keys };
  }
  if (data && typeof data === 'object') {
    const shape = { type: 'object', keys: Object.keys(data) };
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) shape[key] = shapeOf(value);
    }
    return shape;
  }
  return { type: data === null ? 'null' : typeof data };
}

/** Paths the ChatGPT Ads probe may ask: relative, read-only lookups only. */
export function safeProbePath(path) {
  const value = String(path ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/\s|\.\.|[?#]/.test(value)) return null;
  return value;
}
