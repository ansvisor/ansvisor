import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { REPORT_TEMPLATES } from './templates';
import { REPORT_TEMPLATE_TITLES } from './template-titles';

describe('REPORT_TEMPLATE_TITLES', () => {
  it('names each template as the template picker does, so a default title reads the same', () => {
    for (const template of REPORT_TEMPLATES) {
      expect(REPORT_TEMPLATE_TITLES[template.id]).toBe(
        messages.reports.templates[template.id].name,
      );
    }
  });
});
