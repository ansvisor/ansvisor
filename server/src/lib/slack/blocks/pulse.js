import { platformLabel, signed } from '../../pulse/format.js';
import { clip, link, mrkdwn } from './format.js';

/**
 * The Daily Pulse as a Slack message (#2139): the e-mail's numbers,
 * highlights and warnings (lib/pulse/email.js), in Block Kit, with the
 * links to Visibility and to the Pulse's settings. The weekly frequency
 * reads 7 days and says Weekly Pulse, as the e-mail does. Pure.
 *
 * Links, not buttons: a button makes Slack call the app's interactivity
 * address, which only the approvals (later) answer.
 */

/** List items a section shows at most, and a section's text (Slack's cap is 3000). */
const MAX_ITEMS = 5;
const MAX_SECTION = 2900;

/** "▲ +2.1", "▼ -4" or nothing, for a KPI's change. */
function change(value) {
  if (value === null || value === undefined) return '';
  const rounded = Math.round(value * 10) / 10;
  return ` ${rounded >= 0 ? '▲' : '▼'} ${signed(rounded)}`;
}

function highlightLine(h) {
  switch (h.type) {
    case 'first_citation':
      return `First citation for ${h.url ? link(h.url, h.label || h.url) : mrkdwn(h.label)}${h.promptText ? ` — “${mrkdwn(h.promptText)}”` : ''}`;
    case 'prompt_gain':
      return `“${mrkdwn(h.promptText)}” gained *${mrkdwn(signed(h.gain, ' pts'))}* visibility this week`;
    case 'competitor_overtaken':
      return `You overtook *${mrkdwn(h.competitorName)}* on the leaderboard (${mrkdwn(h.brandRate)} vs ${mrkdwn(h.competitorRate)})`;
    case 'new_engine':
      return `First appearance on *${mrkdwn(platformLabel(h.platform))}*`;
    default:
      return null;
  }
}

function warningLine(w) {
  switch (w.type) {
    case 'sharp_drop':
      return `Visibility score dropped sharply: *${mrkdwn(w.from)} → ${mrkdwn(w.to)}* week-over-week`;
    case 'visibility_slipping':
      return `Visibility is slipping: *${mrkdwn(w.from)} → ${mrkdwn(w.to)}* week-over-week`;
    case 'competitor_surge':
      return `*${mrkdwn(w.competitorName)}* surged from ${mrkdwn(w.from)} to ${mrkdwn(w.to)} week-over-week`;
    case 'competitor_crossed':
      return `*${mrkdwn(w.competitorName)}* crossed above your visibility score (${mrkdwn(w.competitorRate)} vs ${mrkdwn(w.brandRate)})`;
    case 'lost_citations':
      return `High-volume prompt “${mrkdwn(w.promptText)}” has stopped citing you for 3 runs in a row`;
    default:
      return null;
  }
}

/** A titled list as one section, its first MAX_ITEMS lines and "and N more". */
function listSection(title, lines) {
  const shown = lines.slice(0, MAX_ITEMS).map((line) => `• ${line}`);
  if (lines.length > MAX_ITEMS) shown.push(`…and ${lines.length - MAX_ITEMS} more`);
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: clip(`*${title}*\n${shown.join('\n')}`, MAX_SECTION) },
  };
}

/**
 * The Pulse's message: Slack's `text` (what a notification shows) and its blocks.
 * @param {{ brandName: string, metrics: object, insightsUrl: string, settingsUrl: string }} input
 */
export function pulseMessage({ brandName, metrics, insightsUrl, settingsUrl }) {
  const { kpis, highlights = [], warnings = [], degradedPlatforms = [], windowDays } = metrics;
  const weekly = windowDays === 7;
  const title = weekly ? 'Weekly Pulse' : 'Daily Pulse';
  const text = `${brandName} ${title}: visibility ${kpis.visibilityRate} (${signed(kpis.weekTrend)} pts this week)`;

  const fields = [
    ['Visibility', String(kpis.visibilityRate)],
    ['7-day trend', `${kpis.weekRate}${change(kpis.weekTrend)}`],
    ['Mentions', `${kpis.mentions}${change(kpis.mentionsChange)}`],
    ['Citations', `${kpis.citations}${change(kpis.citationsChange)}`],
    ['Positive sentiment', `${kpis.sentimentPct}%${change(kpis.sentimentChange)}`],
    ['Prompts you appear in', `${kpis.visiblePrompts}/${kpis.promptCount}`],
  ].map(([label, value]) => ({ type: 'mrkdwn', text: `*${label}*\n${mrkdwn(value)}` }));

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: clip(`${title} · ${brandName}`, 150) } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `How ${mrkdwn(brandName)} showed up in AI answers over the ${weekly ? 'last 7 days' : 'last 24 hours'}.`,
        },
      ],
    },
    { type: 'section', fields },
  ];
  if (degradedPlatforms.length) {
    const names = degradedPlatforms.map(platformLabel).join(', ');
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:warning: Data collection was degraded on ${mrkdwn(names)} today, so drop detection was paused: numbers for ${degradedPlatforms.length > 1 ? 'these platforms' : 'this platform'} may look artificially low.`,
        },
      ],
    });
  }
  const highlightLines = highlights.map(highlightLine).filter(Boolean);
  if (highlightLines.length) blocks.push(listSection('Highlights', highlightLines));
  const warningLines = warnings.map(warningLine).filter(Boolean);
  if (warningLines.length) blocks.push(listSection('Needs attention', warningLines));
  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${link(insightsUrl, 'Open Visibility')}  ·  ${link(settingsUrl, 'Pulse settings')}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Sent by Ansvisor because the ${title} is on for ${mrkdwn(brandName)}, and this channel gets it.`,
        },
      ],
    },
  );
  return { text, blocks };
}
