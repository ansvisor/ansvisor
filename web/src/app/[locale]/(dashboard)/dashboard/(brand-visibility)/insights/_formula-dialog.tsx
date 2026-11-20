'use client';

import { useState } from 'react';
import { Sigma } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { POSITION_SUPPORT_ANSWERS, VISIBILITY_SCORE_WEIGHTS } from '@/lib/visibility-score';

const PCT = {
  mention: Math.round(VISIBILITY_SCORE_WEIGHTS.mention * 100),
  citation: Math.round(VISIBILITY_SCORE_WEIGHTS.citation * 100),
  position: Math.round(VISIBILITY_SCORE_WEIGHTS.position * 100),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-sm text-muted-foreground space-y-1.5">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
      {children}
    </div>
  );
}

/**
 * "Formulas" header button + dialog explaining how every metric on the
 * Insights page is computed. The Visibility weights are read from the
 * shared score module so this stays correct if the blend is ever tuned.
 */
export function FormulaDialog() {
  const [open, setOpen] = useState(false);
  const t = useTranslations('insights.formulas');
  const b = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Sigma className="h-4 w-4" />
        {t('button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <Section title={t('visibility.title')}>
              <p>{t('visibility.body')}</p>
              <Formula>
                {t('visibility.formula', {
                  mention: VISIBILITY_SCORE_WEIGHTS.mention,
                  citation: VISIBILITY_SCORE_WEIGHTS.citation,
                  position: VISIBILITY_SCORE_WEIGHTS.position,
                })}
                <br />
                {t('visibility.confidence', { support: POSITION_SUPPORT_ANSWERS })}
              </Formula>
              <ul className="list-disc ps-5 space-y-1">
                <li>{t.rich('visibility.mentionRate', { b, pct: PCT.mention })}</li>
                <li>{t.rich('visibility.citationRate', { b, pct: PCT.citation })}</li>
                <li>{t.rich('visibility.positionFactor', { b, pct: PCT.position })}</li>
              </ul>
              <p>{t('visibility.competitors')}</p>
            </Section>

            <Section title={t('trend.title')}>
              <p>{t('trend.body')}</p>
            </Section>

            <Section title={t('mentions.title')}>
              <p>{t('mentions.body')}</p>
            </Section>

            <Section title={t('citations.title')}>
              <p>{t('citations.body')}</p>
            </Section>

            <Section title={t('sentiment.title')}>
              <p>{t('sentiment.body')}</p>
              <Formula>{t('sentiment.formula')}</Formula>
            </Section>

            <Section title={t('position.title')}>
              <p>{t('position.body')}</p>
              <Formula>{t('position.formula')}</Formula>
            </Section>

            <Section title={t('citationRate.title')}>
              <p>{t('citationRate.body')}</p>
              <Formula>{t('citationRate.formula')}</Formula>
            </Section>

            <Section title={t('shareOfVoice.title')}>
              <p>{t('shareOfVoice.body')}</p>
              <Formula>{t('shareOfVoice.formula')}</Formula>
            </Section>

            <Section title={t('coverage.title')}>
              <p>{t('coverage.body')}</p>
              <Formula>{t('coverage.formula')}</Formula>
            </Section>

            <Section title={t('changes.title')}>
              <p>{t('changes.body')}</p>
            </Section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
