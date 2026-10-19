/**
 * The AI bots source card's state (AT-010), kept apart from the card so it is
 * tested on its own.
 */

import type { BotConnection, BotConnections, BotUsage } from '@/lib/actions/ai-bots';
import type { TrafficBots } from '@/lib/actions/traffic';

/**
 * locked — the plan has no bot report (Starter: Upgrade);
 * off — nothing connected yet;
 * waiting — connected, no request has arrived yet;
 * on — requests arrive.
 */
export type BotsCardState = 'locked' | 'off' | 'waiting' | 'on';

/** The newest request any connection sent, or null. */
export function lastBotEvent(connections: BotConnection[]): string | null {
  return connections.reduce<string | null>(
    (latest, c) => (c.lastEventAt && (!latest || c.lastEventAt > latest) ? c.lastEventAt : latest),
    null,
  );
}

export function botsCardState({ connections, usage }: BotConnections): BotsCardState {
  if (usage.cap === 0) return 'locked';
  if (connections.length === 0) return 'off';
  return lastBotEvent(connections) ? 'on' : 'waiting';
}

/**
 * The day detailed rows start again when this month's cap was reached
 * ("Detailed rows paused until Nov 1, totals still counted", spec §6.3);
 * null while under the cap.
 */
export function rowsPausedUntil(usage: BotUsage): string | null {
  if (!usage.cappedAt || usage.cap <= 0 || !/^\d{4}-\d{2}-01$/.test(usage.month)) return null;
  const [y, m] = usage.month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/**
 * What the bot report section shows (AT-011, spec §3.7): locked with sample
 * data and Upgrade (Starter); sample data under Connect while nothing is
 * connected; waiting for the first request; or the brand's own data.
 */
export type BotReportState = 'locked' | 'off' | 'waiting' | 'data';

export function botReportState(info: BotConnections, report: TrafficBots | null): BotReportState {
  if (info.usage.cap === 0) return 'locked';
  // Bots counted before a connection was revoked still show.
  if (report?.lastSeen) return 'data';
  return info.connections.length === 0 ? 'off' : 'waiting';
}

/**
 * The sample the locked and unconnected report shows: the mockup's numbers
 * (spec §3.7), last seen 2 hours, 40 minutes and 5 minutes before `now`.
 */
export function sampleBotTypes(now = Date.now()): TrafficBots['types'] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return [
    { type: 'training', hits: 8420, pages: 612, lastSeen: ago(120), bots: ['gptbot', 'claudebot'] },
    {
      type: 'search',
      hits: 3115,
      pages: 488,
      lastSeen: ago(40),
      bots: ['oai-searchbot', 'perplexitybot'],
    },
    {
      type: 'user',
      hits: 1302,
      pages: 214,
      lastSeen: ago(5),
      bots: ['chatgpt-user', 'claude-user'],
    },
  ];
}
