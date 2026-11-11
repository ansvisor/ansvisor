/**
 * The ChatGPT Business Hub features (Businesses in ChatGPT) behind
 * BUSINESS_HUB_ENABLED, until a person with Business Hub access has checked
 * its pages, names and regions.
 *
 * Off unless "true". Production leaves it unset until the launch PR; local
 * development and preview deployments set it to try the features. It is on
 * for everyone on the install or for no one. Read from the environment each
 * time it is asked, as ADS_ENABLED is (web/src/lib/ads/flag.ts): the process
 * sees a change when it starts again. The web reads the same variable the
 * same way (web/src/lib/business-hub/flag.ts). Set both to the same value.
 *
 * @param {NodeJS.ProcessEnv} [env] the variables to read (tests); the process's by default
 * @returns {boolean}
 */
export function businessHubEnabled(env = process.env) {
  return env.BUSINESS_HUB_ENABLED === 'true';
}

/**
 * The regions where a business can claim its profile now, as upper-case ISO
 * country codes. BUSINESS_HUB_OPEN_REGIONS is comma-separated; unset or
 * empty, it is the US only. Elsewhere the setup action says to join the
 * waitlist, and there is no Business Agent task.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function openRegions(env = process.env) {
  const list = String(env.BUSINESS_HUB_OPEN_REGIONS ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return list.length ? [...new Set(list)] : ['US'];
}
