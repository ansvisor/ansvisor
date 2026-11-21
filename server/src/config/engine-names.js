/**
 * Every engine's display name, by the platform id answers are stored under
 * (GL-05). A copy of ENGINE_NAMES in web/src/config/platform-labels.ts, which
 * is the source; a web test keeps the two the same. E-mails, Slack messages
 * and model prompts name engines from here, never by raw id.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** @type {Readonly<Record<string, string>>} */
export const ENGINE_NAMES = Object.freeze(require('./engine-names.json'));

/** An engine's display name, or its id when it isn't known. */
export function engineName(id) {
  return Object.hasOwn(ENGINE_NAMES, id) ? ENGINE_NAMES[id] : id;
}
