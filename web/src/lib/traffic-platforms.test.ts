import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPlatformName } from './traffic-platforms';
import { getColor } from '@/app/[locale]/(dashboard)/dashboard/traffic/_charts';

/**
 * Every engine on the AI source list (server/src/lib/ai-sources.json, AT-004)
 * has a name and a color on the AI Traffic page; otherwise a new engine would
 * show as a grey raw hostname.
 */

const list = JSON.parse(
  readFileSync(join(__dirname, '../../../server/src/lib/ai-sources.json'), 'utf8'),
) as { sources: { key: string }[] };

describe('the AI source list on the page', () => {
  it('names every engine on the list', () => {
    for (const { key } of list.sources) {
      expect(getPlatformName(key), key).not.toBe(key);
    }
  });

  it('colors every engine on the list', () => {
    const fallback = getColor('not-an-engine.example');
    for (const { key } of list.sources) {
      expect(getColor(key), key).not.toBe(fallback);
    }
  });
});
