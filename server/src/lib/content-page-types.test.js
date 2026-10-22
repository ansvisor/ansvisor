import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_TYPE_FORMATS, pageTypeFormat } from './content-page-types.js';

describe('pageTypeFormat', () => {
  it('names a page type as the person picks it, with its format', () => {
    expect(pageTypeFormat('solution_page')).toBe(
      'Use case page: how the product serves one use case, industry or team',
    );
    expect(pageTypeFormat('guide')).toMatch(/^How-to guide: numbered steps/);
  });

  it('says so when there is none, and passes on a type it doesn’t know', () => {
    expect(pageTypeFormat(null)).toBe('not set');
    expect(pageTypeFormat('')).toBe('not set');
    expect(pageTypeFormat('constructor')).toBe('constructor');
    expect(pageTypeFormat('webinar_page')).toBe('webinar_page');
  });

  it('covers every page type the editor offers, under the name the person sees', () => {
    const drafts = readFileSync(
      new URL('../../../web/src/lib/content/drafts.ts', import.meta.url),
      'utf8',
    );
    const list = drafts.match(/export const PAGE_TYPES = \[([\s\S]*?)\] as const/)[1];
    const types = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(Object.keys(PAGE_TYPE_FORMATS).sort()).toEqual([...types].sort());

    const messages = JSON.parse(
      readFileSync(new URL('../../../web/messages/en.json', import.meta.url), 'utf8'),
    );
    for (const [type, label] of Object.entries(messages.contentEditor.pageTypes)) {
      expect(PAGE_TYPE_FORMATS[type].split(':')[0]).toBe(label);
    }
  });
});
