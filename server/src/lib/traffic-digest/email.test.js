import { describe, expect, it } from 'vitest';
import { renderTrafficDigestEmail } from './email.js';

/** The AI Traffic weekly digest's e-mail (AT-013). */

const digest = (over = {}) =>
  renderTrafficDigestEmail({
    brandName: 'Acme <Coffee>',
    week: { firstDay: '2026-10-12', lastDay: '2026-10-18' },
    visits: 42,
    change: -30,
    sentences: ['Last week: 42 AI-referred visits, down 30% on the week before.'],
    changes: [{ type: 'platform', name: 'chatgpt.com', before: 30, now: 12 }],
    trafficUrl: 'https://app.example.com/dashboard/traffic',
    settingsUrl: 'https://app.example.com/dashboard/settings?tab=notifications',
    ...over,
  });

describe('renderTrafficDigestEmail', () => {
  it('leads with the visits and their change, then the summary line and the top changes', () => {
    const { subject, html } = digest();
    expect(subject).toBe('Acme <Coffee> AI traffic last week: 42 AI visits (−30%)');
    expect(html).toContain('AI Traffic weekly — Acme &lt;Coffee&gt;');
    expect(html).toContain('Oct 12 – Oct 18');
    expect(html).toContain('Last week: 42 AI-referred visits, down 30% on the week before.');
    expect(html).toContain('Top changes');
    expect(html).toContain('ChatGPT sent 12 AI visits, down from 30.');
    expect(html).toContain('href="https://app.example.com/dashboard/traffic"');
    expect(html).toContain('href="https://app.example.com/dashboard/settings?tab=notifications"');
    // Nothing the brand typed reaches the HTML unescaped.
    expect(html).not.toContain('<Coffee>');
  });

  it('leaves out a change it cannot state, and the list when nothing moved', () => {
    const { subject, html } = digest({ visits: 1, change: null, changes: [] });
    expect(subject).toBe('Acme <Coffee> AI traffic last week: 1 AI visit');
    expect(html).not.toContain('Top changes');
  });
});
