'use client';

import { useTranslations } from 'next-intl';
import type { AuditSignal } from '@/lib/actions/audits';

/** The signal whose sources this explains. */
export const AUTHORITY_SIGNAL = 'outbound-authority-links';

/** What a counted site is (server audit/authority-sources.js), as the report names it. */
const KINDS = ['official', 'international', 'research', 'news'] as const;
type AuthorityKind = (typeof KINDS)[number];
const isKind = (value: unknown): value is AuthorityKind => KINDS.includes(value as AuthorityKind);

/** How many sites the signal needs to pass. */
const TO_PASS = 2;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Outbound authority links, opened in the report (customer priorities item
 * 6): the sites that counted and what each is, others the page links to
 * that don't, and what counts. An audit from before names only the sites
 * that counted.
 */
export function AuthoritySources({ signal }: { signal: AuditSignal }) {
  const t = useTranslations('audit.authority');
  const found = strings(signal.evidence.authorityHosts);
  const others = strings(signal.evidence.otherHosts);
  const kinds = (signal.evidence.authorityKinds ?? {}) as Record<string, unknown>;

  return (
    <div data-slot="authority-sources" className="space-y-2">
      <p>
        <span className="font-medium text-foreground">{t('found')}: </span>
        {found.length === 0 ? (
          t('none', { count: TO_PASS })
        ) : (
          <>
            {found.map((host) => {
              const kind = kinds[host];
              return (
                <span
                  key={host}
                  title={isKind(kind) ? t(`kinds.${kind}`) : undefined}
                  className="mr-1 inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
                >
                  {host}
                </span>
              );
            })}
            {found.length < TO_PASS && t('oneMore')}
          </>
        )}
      </p>
      {others.length > 0 && <p>{t('others', { sites: others.join(', ') })}</p>}
      <div className="space-y-1.5 rounded-lg border px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">{t('whatCounts')}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          {KINDS.map((kind) => (
            <li key={kind}>{t(`counts.${kind}`)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
