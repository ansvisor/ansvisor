import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './format';
import { readYamlFrontMatter } from './front-matter-yaml';

/**
 * A Library skill's YAML front matter (owner, 2026-11-05): the safe subset
 * its authors write (folded and literal blocks, values over several lines,
 * nested metadata, lists, one-line JSON) is written back in the one-line
 * form the format reader takes; anything outside the subset is refused
 * (null), so the strict reader says why.
 */

/** The front matter read, then read again by the format reader. */
function read(front: string) {
  const yaml = readYamlFrontMatter(front);
  if (!yaml) return null;
  const { skill, problems } = parseSkillFile(`---\n${yaml.text}\n---\nBody.\n`);
  return { ...yaml, skill, problems };
}

describe('readYamlFrontMatter', () => {
  it('reads a folded description over several lines, and keeps the other keys by name', () => {
    const got = read(`name: seo-geo
description: >
  Audit and improve content for AI Overviews and answer engines, including
  citability, entity clarity, crawler access: brand signals, and passage
  structure.
user-invocable: true
argument-hint: "[url]"
license: MIT
metadata:
  author: AgriciDaniel
  version: "2.4.2"`);
    expect(got).not.toBeNull();
    expect(got!.problems).toEqual([
      'user-invocable is not a SKILL.md field',
      'argument-hint is not a SKILL.md field',
    ]);
    expect(got!.skill).toMatchObject({
      name: 'seo-geo',
      description:
        'Audit and improve content for AI Overviews and answer engines, including citability, entity clarity, crawler access: brand signals, and passage structure.',
      license: 'MIT',
      metadata: { author: 'AgriciDaniel', version: '2.4.2' },
    });
    expect(got!.dropped).toEqual([]);
  });

  it('keeps a literal block’s lines, and a folded block’s blank line as a break', () => {
    const literal = read(`name: a\ndescription: |\n  First line.\n  Second line.\n`);
    expect(literal!.skill.description).toBe('First line.\nSecond line.');
    const folded = read(`name: a\ndescription: >-\n  One\n  paragraph.\n\n  Two.\n`);
    expect(folded!.skill.description).toBe('One paragraph.\nTwo.');
  });

  it('reads quoted and plain values that go on over the lines under them', () => {
    const got = read(`name: a
description: "Tightens copy:
  keeps your voice."
compatibility: 'It''s for
  Claude Code'
license: MIT License
  (see LICENSE) # a comment`);
    expect(got!.skill).toMatchObject({
      description: 'Tightens copy: keeps your voice.',
      compatibility: "It's for Claude Code",
      license: 'MIT License (see LICENSE)',
    });
  });

  it('drops metadata that isn’t text, and joins a list of text', () => {
    const got = read(`name: at-email-cli
description: Operates an agent mailbox.
metadata:
  title: Agent mailbox
  tags: [email, "cli, tools"]
  keywords:
    - inbox
    - mail
  openclaw:
    requires:
      anyBins:
        - at-email
    envVars:
      - name: AT_EMAIL_API_BASE_URL
        required: false`);
    expect(got!.problems).toEqual([]);
    expect(got!.skill.metadata).toEqual({
      title: 'Agent mailbox',
      tags: 'email, cli, tools',
      keywords: 'inbox, mail',
    });
    expect(got!.dropped).toEqual(['metadata.openclaw']);
  });

  it('reads one-line JSON metadata, and a list at the key’s own indent', () => {
    const got = read(`name: retention-tracker
description: "Track construction retainage."
metadata: {"openclaw": {"emoji": "💵", "os": ["darwin"]}, "category": "finance", "level": 2}
allowed-tools:
- Read
- Write`);
    expect(got!.skill.metadata).toEqual({ category: 'finance', level: '2' });
    expect(got!.dropped).toEqual(['metadata.openclaw']);
    expect(got!.problems).toEqual(['allowed-tools is not allowed: skills run instructions only']);
  });

  it('refuses what is outside the subset', () => {
    const outside = [
      'name: a\ndescription: &d Shared\nlicense: *d',
      'name: a\ndescription: !!str Tagged',
      'name: a\ndescription: {not: json}',
      'name: a\n? complex\n: key',
      'name: a\ndescription: one\ndescription: two',
      'name: a\n\tdescription: tab',
      'name: a\ndescription: "never closed',
      'name: a\ndescription:\n  nested: map',
      `name: a\n${'k: v\n'.repeat(300)}`,
    ];
    for (const front of outside) expect(readYamlFrontMatter(front)).toBeNull();
  });

  it('keeps a prototype’s key names as the skill’s own', () => {
    const got = read(
      'name: a\ndescription: Does a thing.\nmetadata:\n  constructor: x\n  __proto__: y',
    );
    expect(Object.entries(got!.skill.metadata)).toEqual([
      ['constructor', 'x'],
      ['__proto__', 'y'],
    ]);
    expect(Object.getPrototypeOf(got!.skill.metadata)).toBeNull();
  });
});
