import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { forgetMessages } from '../i18n.js';
import { renderPulseEmail } from './email.js';

const metrics = {
  kpis: {
    visibilityRate: 42,
    weekRate: 43,
    weekTrend: 1.2,
    mentions: 20,
    mentionsChange: 2,
    citations: 8,
    citationsChange: -1,
    sentimentPct: 75,
    sentimentChange: 0,
    visiblePrompts: 4,
    promptCount: 10,
  },
  highlights: [],
  warnings: [],
  degradedPlatforms: [],
  windowDays: 7,
};

describe('renderPulseEmail', () => {
  it('escapes user-controlled HTML values', () => {
    const { html } = renderPulseEmail({
      brandName: '<script>alert("x")</script>',
      metrics: {
        ...metrics,
        highlights: [
          {
            type: 'prompt_gain',
            promptText: '<script>alert("prompt")</script>',
            gain: 1.5,
          },
          {
            type: 'competitor_overtaken',
            competitorName: 'Bad "Brand"',
            brandRate: 12,
            competitorRate: 8,
          },
        ],
      },
      insightsUrl: 'https://example.com/insights?a=1&b=2',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;prompt&quot;)&lt;/script&gt;');
    expect(html).toContain('Bad &quot;Brand&quot;');
    expect(html).not.toContain('<script>alert("prompt")</script>');
  });

  it('renders the degraded-platform notice only when needed', () => {
    const healthy = renderPulseEmail({
      brandName: 'Acme',
      metrics,
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });
    expect(healthy.html).not.toContain('Data collection was degraded');

    const degraded = renderPulseEmail({
      brandName: 'Acme',
      metrics: { ...metrics, degradedPlatforms: ['chatgpt-web', 'perplexity-web'] },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });
    expect(degraded.html).toContain('Data collection was degraded on ChatGPT, Perplexity today');
  });

  it('renders a visibility slip under Needs attention', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: {
        ...metrics,
        warnings: [
          { type: 'visibility_slipping', key: 'visibility_slipping', from: 42, to: 35, drop: 7 },
        ],
      },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('⚠ Needs attention');
    expect(html).toContain(
      'Visibility score is slipping: <strong>42 → 35</strong> from the 7 days before to the last 7 days',
    );
  });

  it('names the pulse after its window in the subject and heading', () => {
    const render = (windowDays) =>
      renderPulseEmail({
        brandName: 'Acme',
        metrics: { ...metrics, windowDays },
        insightsUrl: 'https://example.com/insights',
        settingsUrl: 'https://example.com/settings',
      });

    const weekly = render(7);
    expect(weekly.subject).toBe(
      'Acme Weekly Pulse — visibility score 42/100, 7-day average 43/100 (+1.2 pts)',
    );
    expect(weekly.html).toContain('Weekly Pulse — Acme</h1>');

    const daily = render(1);
    expect(daily.subject).toBe(
      'Acme Daily Pulse — visibility score 42/100, 7-day average 43/100 (+1.2 pts)',
    );
    expect(daily.html).toContain('Daily Pulse — Acme</h1>');
  });

  it('uses the rounded change when selecting the KPI trend arrow', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: { ...metrics, kpis: { ...metrics.kpis, weekTrend: -0.04 } },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('color:#059669;">▲ 0 pts vs the 7 days before</div>');
    expect(html).not.toContain('color:#dc2626;">▼ 0');
  });

  // D1/D2/D4 (metric dictionary): the score is points out of 100, the trend
  // tile says it is a 7-day average and what its change compares, and the
  // prompt tile names the prompts it counts and their period.
  it('names each KPI, its unit and its period', () => {
    const render = (windowDays) =>
      renderPulseEmail({
        brandName: 'Acme',
        metrics: {
          ...metrics,
          windowDays,
          kpis: { ...metrics.kpis, visibilityRate: 28.1, weekRate: 28.3, weekTrend: 0.3 },
        },
        insightsUrl: 'https://example.com/insights',
        settingsUrl: 'https://example.com/settings',
      }).html;

    const daily = render(1);
    expect(daily).toContain('>Visibility score</div>');
    expect(daily).toContain('>28.1/100</div>');
    expect(daily).toContain('>7-day average</div>');
    expect(daily).toContain('>28.3/100</div>');
    expect(daily).toContain('▲ +0.3 pts vs the 7 days before</div>');
    expect(daily).toContain('>Prompts with a mention</div>');
    expect(daily).toContain('>4 of 10</div>');
    expect(daily).toContain('>10 prompts with answers in the last 24 hours</div>');
    expect(daily).toContain('over the last 24 hours. A line that covers another period names it.');
    expect(daily).not.toContain('Prompts you appear in');
    expect(daily).not.toContain('7-day trend');

    const weekly = render(7);
    expect(weekly).toContain('>10 prompts with answers in the last 7 days</div>');

    const one = renderPulseEmail({
      brandName: 'Acme',
      metrics: { ...metrics, kpis: { ...metrics.kpis, visiblePrompts: 1, promptCount: 1 } },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    }).html;
    expect(one).toContain('>1 prompt with answers in the last 7 days</div>');
  });

  it('says the period of every week-on-week highlight and warning', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: {
        ...metrics,
        highlights: [
          { type: 'prompt_gain', promptText: 'best crm', gain: 19 },
          {
            type: 'competitor_overtaken',
            competitorName: 'Contoso',
            brandRate: 34,
            competitorRate: 30,
          },
        ],
        warnings: [
          { type: 'sharp_drop', from: 40, to: 20 },
          { type: 'competitor_surge', competitorName: 'Fabrikam', from: 10, to: 26 },
          {
            type: 'competitor_crossed',
            competitorName: 'Initech',
            competitorRate: 45,
            brandRate: 42,
          },
        ],
      },
      insightsUrl: 'https://example.com/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain(
      '“best crm” gained <strong>+19 pts</strong> visibility score in the last 7 days, vs the 7 days before',
    );
    expect(html).toContain(
      'You overtook <strong>Contoso</strong> on the leaderboard in the last 7 days (visibility score 34 vs 30)',
    );
    expect(html).toContain(
      'Visibility score dropped sharply: <strong>40 → 20</strong> from the 7 days before to the last 7 days',
    );
    expect(html).toContain(
      '<strong>Fabrikam</strong> surged from 10 (the 7 days before) to 26 (the last 7 days)',
    );
    expect(html).toContain(
      '<strong>Initech</strong> crossed above your visibility score in the last 7 days (45 vs 42)',
    );
    expect(html).not.toContain('this week');
    expect(html).not.toContain('week-over-week');
  });

  // The page is Visibility (Brand Visibility until 2026-11-06); its Overview keeps /dashboard/insights.
  it('names the page it opens Visibility', () => {
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics,
      insightsUrl: 'https://app.example.com/dashboard/insights',
      settingsUrl: 'https://example.com/settings',
    });

    expect(html).toContain('href="https://app.example.com/dashboard/insights"');
    expect(html).toContain('>Open Visibility</a>');
    expect(html).not.toContain('Open Insights');
    expect(html).not.toContain('Brand Visibility');
  });
});

describe('campaign tags', () => {
  const links = {
    insightsUrl: 'https://app.example.com/dashboard/insights',
    settingsUrl: 'https://app.example.com/dashboard/settings?tab=notifications',
  };

  it('tags links into the app and keeps the existing query', async () => {
    const { tagAppLink } = await import('./email.js');
    const tagged = new URL(tagAppLink(links.settingsUrl, 'https://app.example.com'));
    expect(tagged.searchParams.get('tab')).toBe('notifications');
    expect(tagged.searchParams.get('utm_source')).toBe('pulse');
    expect(tagged.searchParams.get('utm_medium')).toBe('email');
    expect(tagged.searchParams.get('utm_campaign')).toBe('daily_pulse');
  });

  it('leaves other domains alone', async () => {
    const { tagAppLink } = await import('./email.js');
    const other = 'https://example.org/page?x=1';
    expect(tagAppLink(other, 'https://app.example.com')).toBe(other);
  });

  it('tags the buttons in the email but not cited URLs', () => {
    process.env.PUBLIC_APP_URL = 'https://app.example.com';
    const { html } = renderPulseEmail({
      brandName: 'Acme',
      metrics: {
        ...metrics,
        highlights: [{ type: 'first_citation', url: 'https://cited.example.org/a' }],
      },
      ...links,
    });
    expect(html).toContain(
      'insights?utm_source=pulse&amp;utm_medium=email&amp;utm_campaign=daily_pulse',
    );
    expect(html).toContain('tab=notifications&amp;utm_source=pulse');
    expect(html).toContain('href="https://cited.example.org/a"');
  });
});

describe('the Pulse in the reader’s language (LOC-008)', () => {
  const links = {
    insightsUrl: 'https://app.example.com/i',
    settingsUrl: 'https://app.example.com/s',
  };

  it('reads English exactly as before when no language is given', () => {
    const { subject, html } = renderPulseEmail({ brandName: 'Acme', metrics, ...links });
    expect(subject).toBe(
      'Acme Weekly Pulse — visibility score 42/100, 7-day average 43/100 (+1.2 pts)',
    );
    expect(html).toContain('How your brand showed up in AI answers over the last 7 days.');
    expect(html).toContain('>75%<');
    expect(html).toContain('>4 of 10<');
  });

  it('writes the words and numbers in German, English where German has no text', () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../messages/de.json',
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        pulse: {
          titleWeek: 'Wochen-Pulse',
          subject: '{brand} {title} — Sichtbarkeit {rate} ({trend} Pkt. diese Woche)',
          warning: { slipping: 'Sichtbarkeit sinkt: {change} zur Vorwoche' },
        },
      }),
    );
    forgetMessages();
    try {
      const { subject, html } = renderPulseEmail({
        brandName: 'Acme',
        metrics: {
          ...metrics,
          kpis: { ...metrics.kpis, visibilityRate: 42.5 },
          warnings: [{ type: 'visibility_slipping', from: 50.5, to: 42.5 }],
        },
        ...links,
        locale: 'de',
      });
      expect(subject).toBe('Acme Wochen-Pulse — Sichtbarkeit 42,5 (+1,2 Pkt. diese Woche)');
      expect(html).toContain('Sichtbarkeit sinkt: <strong>50,5 → 42,5</strong> zur Vorwoche');
      expect(html).toContain('75 %');
      expect(html).toContain('Open Visibility');
    } finally {
      fs.rmSync(file, { force: true });
      forgetMessages();
    }
  });
});
