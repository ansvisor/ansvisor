'use client';

import { useTranslations } from 'next-intl';
import type { AuditSignal } from '@/lib/actions/audits';
import { cn } from '@/lib/utils';

/** The signal whose per-bot answers this shows. */
export const BOT_ACCESS_SIGNAL = 'ai-bot-access';

type Live = 'ok' | 'blocked' | 'error' | 'no_answer' | 'not_tested' | 'inconclusive';

/** One AI bot as the check read it (server signals/trust.js `bots`). */
interface BotRow {
  key: string;
  name: string;
  robots: 'allowed' | 'blocked';
  http: number | null;
  live: Live | null;
}

const LIVE = ['ok', 'blocked', 'error', 'no_answer', 'not_tested', 'inconclusive'];

function botRows(value: unknown): BotRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== 'object') return [];
    const b = v as Record<string, unknown>;
    if (typeof b.key !== 'string' || typeof b.name !== 'string') return [];
    return [
      {
        key: b.key,
        name: b.name,
        robots: b.robots === 'blocked' ? 'blocked' : 'allowed',
        http: typeof b.http === 'number' ? b.http : null,
        live: LIVE.includes(b.live as string) ? (b.live as Live) : null,
      },
    ];
  });
}

/** What a bot's cell says, and whether it is a block. */
function cellOf(bot: BotRow): { text: 'robots' | 'http' | 'noAnswer' | 'allowed'; bad: boolean } {
  if (bot.robots === 'blocked') return { text: 'robots', bad: true };
  if (bot.live === 'blocked') return { text: 'http', bad: true };
  if ((bot.live === 'ok' || bot.live === 'error') && bot.http !== null) {
    return { text: 'http', bad: false };
  }
  if (bot.live === 'no_answer') return { text: 'noAnswer', bad: false };
  return { text: 'allowed', bad: false };
}

/**
 * AI bot access, opened in the report (Site Audit spec §6.3, SA-008): each
 * AI bot with the answer the page gave it, from robots.txt and from the live
 * test that asks the page as the bot, and the blocks only a CDN or firewall
 * explains. An audit from before the live test lists no bots.
 */
export function BotAccess({ signal }: { signal: AuditSignal }) {
  const t = useTranslations('audit.botAccess');
  const tAudit = useTranslations('audit');
  const bots = botRows(signal.evidence.bots);
  if (bots.length === 0) return null;
  const firewall = bots.filter((b) => b.robots === 'allowed' && b.live === 'blocked');
  const robots = bots.filter((b) => b.robots === 'blocked');
  const liveTest = signal.evidence.liveTest;
  const control = typeof signal.evidence.control === 'number' ? signal.evidence.control : null;
  const names = (rows: BotRow[]) => rows.map((b) => b.name).join(', ');

  let finding: string | null = null;
  if (firewall.length > 0)
    finding = t('firewall', { bots: names(firewall), count: firewall.length });
  else if (robots.length > 0) finding = t('robots', { bots: names(robots), count: robots.length });
  else if (liveTest === 'done') finding = t('allLetIn');
  else if (liveTest === 'inconclusive') finding = t('inconclusive', { status: control ?? '—' });

  return (
    <div data-slot="bot-access" className="space-y-2">
      {finding && (
        <p>
          <span className="font-medium text-foreground">{tAudit('finding')}: </span>
          {finding}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {bots.map((bot) => {
          const cell = cellOf(bot);
          return (
            <li
              key={bot.key}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                cell.bad && 'border-destructive/30 bg-destructive/10',
              )}
            >
              <span className="truncate text-foreground">{bot.name}</span>
              <span
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  cell.bad ? 'text-destructive' : 'text-foreground',
                )}
              >
                {cell.text === 'http' ? bot.http : t(`cell.${cell.text}`)}
              </span>
            </li>
          );
        })}
      </ul>
      {liveTest ? <p className="text-xs">{t('note')}</p> : null}
    </div>
  );
}
