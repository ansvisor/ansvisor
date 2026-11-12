import { describe, expect, it } from 'vitest';
import { AI_SOURCES } from '../ai-sources.js';
import {
  GROUP,
  PROPERTY_NAMES,
  SOURCE_LABELS,
  contactProperties,
  missingOptions,
  sourceOptions,
} from './properties.js';

/** The "Ansvisor" property group and its contact properties (#2140). */

describe('the Ansvisor properties', () => {
  it('are in the Ansvisor group, named apart from any of the customer’s own', () => {
    const properties = contactProperties();
    expect(GROUP).toMatchObject({ name: 'ansvisor', label: 'Ansvisor' });
    expect(properties.every((p) => p.groupName === 'ansvisor')).toBe(true);
    expect(PROPERTY_NAMES).toEqual([
      'ansvisor_ai_source',
      'ansvisor_ai_landing_page',
      'ansvisor_ai_first_visit_at',
      'ansvisor_ai_converted_at',
      'ansvisor_brand',
      'ansvisor_brand_id',
    ]);
    expect(new Set(PROPERTY_NAMES).size).toBe(PROPERTY_NAMES.length);
    // Never on a form, and HubSpot's own field type for each kind.
    for (const p of properties) {
      expect(p.formField).toBe(false);
      expect({ type: p.type, fieldType: p.fieldType }).toEqual(
        {
          enumeration: { type: 'enumeration', fieldType: 'select' },
          string: { type: 'string', fieldType: 'text' },
          datetime: { type: 'datetime', fieldType: 'date' },
        }[p.type],
      );
    }
    // The brand's id is for Ansvisor's report, not people.
    expect(properties.find((p) => p.name === 'ansvisor_brand_id').hidden).toBe(true);
    expect(properties.filter((p) => p.hidden).map((p) => p.name)).toEqual(['ansvisor_brand_id']);
  });

  it('offer every AI source of the list by its name, keyed as the list keys it', () => {
    for (const source of AI_SOURCES) expect(SOURCE_LABELS[source.key], source.key).toBeTruthy();
    const options = sourceOptions();
    expect(options.map((o) => o.value)).toEqual(AI_SOURCES.map((s) => s.key));
    expect(options[0]).toEqual({
      label: 'ChatGPT',
      value: 'chatgpt.com',
      displayOrder: 0,
      hidden: false,
    });
    // A source the labels don't know yet is offered by its key.
    expect(sourceOptions([{ key: 'new.ai' }])[0]).toMatchObject({ label: 'new.ai' });
  });
});

describe('missingOptions', () => {
  it('adds what HubSpot lacks after its own options, and removes nothing', () => {
    const existing = [
      { label: 'ChatGPT', value: 'chatgpt.com', displayOrder: 0 },
      { label: 'Old one', value: 'old.ai', displayOrder: 7 },
    ];
    const wanted = sourceOptions([
      { key: 'chatgpt.com' },
      { key: 'claude.ai' },
      { key: 'meta.ai' },
    ]);
    expect(missingOptions(existing, wanted)).toEqual([
      { label: 'Claude', value: 'claude.ai', displayOrder: 8, hidden: false },
      { label: 'Meta AI', value: 'meta.ai', displayOrder: 9, hidden: false },
    ]);
    expect(missingOptions(wanted, wanted)).toEqual([]);
    expect(missingOptions(undefined, wanted.slice(0, 1))).toHaveLength(1);
  });
});
