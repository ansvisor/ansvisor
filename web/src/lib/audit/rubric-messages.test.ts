import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Site Audit's rubric copy in the messages (LOC) is the server's rubric.json,
 * word for word: the server keeps the rubric for scoring and its prompts, the
 * interface shows the messages' copy, translated. Change one, change both.
 */

type Rubric = {
  categories: { key: string; label: string; description: string }[];
  signals: ({ key: string } & Record<string, unknown>)[];
};

const rubric = JSON.parse(
  readFileSync(join(__dirname, '../../../../server/src/lib/audit/rubric.json'), 'utf8'),
) as Rubric;

const FIELDS = ['label', 'what', 'why', 'howToFix', 'evidenceNote'] as const;

describe('auditRubric messages', () => {
  it('hold every category of rubric.json, as it words them', () => {
    expect(messages.auditRubric.categories).toEqual(
      Object.fromEntries(
        rubric.categories.map((c) => [c.key, { label: c.label, description: c.description }]),
      ),
    );
  });

  it('hold every signal of rubric.json, as it words them', () => {
    expect(messages.auditRubric.signals).toEqual(
      Object.fromEntries(
        rubric.signals.map((s) => [
          s.key,
          Object.fromEntries(FIELDS.filter((f) => s[f]).map((f) => [f, s[f]])),
        ]),
      ),
    );
  });
});
