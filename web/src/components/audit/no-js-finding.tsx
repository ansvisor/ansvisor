'use client';

import { useTranslations } from 'next-intl';
import { crawlerName } from '@/lib/signals/names';

/** The signal this explains (server signals/structure.js noJsContent). */
export const NO_JS_SIGNAL = 'no-js-content';

export interface NoJsEvidence {
  /** Share of the main text's words that appear only after JavaScript runs, 0–100. */
  hiddenPercent: number;
  hiddenWords: number;
  mainWords: number;
  /** The first blocks it hides, cut short. */
  hiddenText: string[];
  /** The bot whose HTML was read (`gptbot`). */
  readAs: string;
}

const whole = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/** The no-JS check's evidence, or null for one it couldn't compare. */
export function noJsEvidence(evidence: Record<string, unknown>): NoJsEvidence | null {
  const hiddenPercent = whole(evidence.hiddenPercent);
  const hiddenWords = whole(evidence.hiddenWords);
  const mainWords = whole(evidence.mainWords);
  if (hiddenPercent === null || hiddenWords === null || mainWords === null) return null;
  const hiddenText = Array.isArray(evidence.hiddenText)
    ? evidence.hiddenText.filter((t): t is string => typeof t === 'string')
    : [];
  const readAs = typeof evidence.readAs === 'string' ? evidence.readAs : 'gptbot';
  return { hiddenPercent, hiddenWords, mainWords, hiddenText, readAs };
}

/**
 * Main text without JavaScript, opened in the report (Site Audit spec §6.3,
 * SA-009): how much of the page's main text an AI bot doesn't get before
 * JavaScript runs, and the first passages it misses.
 */
export function NoJsFinding({ evidence }: { evidence: NoJsEvidence }) {
  const t = useTranslations('audit');
  const bot = crawlerName(evidence.readAs).replace(/\s*\(.*\)$/, '');
  return (
    <div data-slot="no-js" className="space-y-1">
      <p>
        <span className="font-medium text-foreground">{t('finding')}: </span>
        {t('evidence.noJs', {
          percent: evidence.hiddenPercent,
          hidden: evidence.hiddenWords,
          words: evidence.mainWords,
          bot,
        })}
      </p>
      {evidence.hiddenText.length > 0 && (
        <>
          <p>{t('evidence.noJsHidden', { bot })}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {evidence.hiddenText.map((text, i) => (
              <li key={i}>“{text}”</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
