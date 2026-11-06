'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sigma } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AuditEvidenceLevel } from '@/lib/actions/audits';

/** The levels a signal is shown with (SA-010); informational reads as hygiene, left out of the score. */
const SHOWN_LEVELS = [
  'strong',
  'likely',
  'hygiene',
] as const satisfies readonly AuditEvidenceLevel[];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-1.5 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

/**
 * The report's Formula button and panel (Site Audit spec §6.2, SA-010): the
 * category weights the total is worked out with, how a category adds up its
 * signals, what each evidence level means, and the signals left out of the
 * score.
 */
export function ScoreFormula({
  categories,
  notScored,
}: {
  categories: { key: string; label: string; weight: number }[];
  /** Labels of the informational signals in this report, such as "llms.txt presence". */
  notScored: string[];
}) {
  const t = useTranslations('audit');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Sigma className="h-3.5 w-3.5" />
        {t('formula.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('formula.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <Section title={t('formula.totalTitle')}>
              <p>{t('formula.total')}</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                {categories.map((c) => (
                  <li key={c.key} className="flex justify-between gap-2 whitespace-nowrap">
                    <span>{c.label}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {t('formula.weight', { weight: Math.round(c.weight * 100) })}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title={t('formula.categoryTitle')}>
              <p>{t('formula.category')}</p>
            </Section>
            <Section title={t('formula.evidenceTitle')}>
              <p>{t('formula.evidenceIntro')}</p>
              <ul className="space-y-1">
                {SHOWN_LEVELS.map((level) => (
                  <li key={level}>
                    <span className="font-medium text-foreground">
                      {t(`evidenceLevel.${level}`)}
                    </span>
                    {': '}
                    {t(`formula.evidence.${level}`)}
                  </li>
                ))}
              </ul>
            </Section>
            {notScored.length > 0 && (
              <Section title={t('formula.notScoredTitle')}>
                <p>{t('formula.notScored', { signals: notScored.join(', ') })}</p>
              </Section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
