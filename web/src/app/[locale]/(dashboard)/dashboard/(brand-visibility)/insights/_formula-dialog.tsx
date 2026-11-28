'use client';

import { useCallback, useState } from 'react';
import { Sigma } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { POSITION_SUPPORT_ANSWERS, VISIBILITY_SCORE_WEIGHTS } from '@/lib/visibility-score';
import type { RateSample } from './kpi-format';

const PCT = {
  mention: Math.round(VISIBILITY_SCORE_WEIGHTS.mention * 100),
  citation: Math.round(VISIBILITY_SCORE_WEIGHTS.citation * 100),
  position: Math.round(VISIBILITY_SCORE_WEIGHTS.position * 100),
};

/** The dialog's sections, in order; a KPI card opens the dialog on its own. */
export type FormulaSection =
  | 'visibility'
  | 'trend'
  | 'mentions'
  | 'citations'
  | 'sentiment'
  | 'position'
  | 'citationRate'
  | 'shareOfVoice'
  | 'coverage'
  | 'changes';

function Section({
  id,
  title,
  active,
  sample,
  children,
}: {
  id: FormulaSection;
  title: string;
  /** Opened from this section's card: scrolled to and marked. */
  active: boolean;
  /** How many answers the card's number is based on, when the card knows. */
  sample?: RateSample;
  children: React.ReactNode;
}) {
  const tKpi = useTranslations('insights.kpi');
  // A callback ref: the dialog's content mounts a render after it opens.
  const scrollTo = useCallback(
    (el: HTMLElement | null) => {
      if (active) el?.scrollIntoView?.({ block: 'start' });
    },
    [active],
  );
  return (
    <section
      ref={scrollTo}
      data-formula-section={id}
      data-active={active || undefined}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'space-y-1.5 scroll-mt-2',
        active && '-mx-3 rounded-lg border bg-accent/40 px-3 py-2.5',
      )}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-sm text-muted-foreground space-y-1.5">{children}</div>
      {sample && (
        <p data-slot="formula-sample" className="text-xs font-medium text-foreground">
          {tKpi(`sampleTip.${sample.of}`, { count: sample.count })}
        </p>
      )}
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

interface FormulaDialogProps {
  /** Controlled: opened from a KPI card. Without it the header button opens the dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The section to scroll to and mark, for the card that opened the dialog. */
  section?: FormulaSection | null;
  /** Each section's sample size, from the cards that know it. */
  samples?: Partial<Record<FormulaSection, RateSample>>;
}

/**
 * "Formulas" header button + dialog explaining how every metric on the
 * Insights page is computed. The Visibility weights are read from the
 * shared score module so this stays correct if the blend is ever tuned.
 * Controlled (`open`), it has no button: a KPI card opens it on its section.
 */
export function FormulaDialog({
  open: openProp,
  onOpenChange,
  section = null,
  samples,
}: FormulaDialogProps = {}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const t = useTranslations('insights.formulas');
  const b = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );
  const at = (id: FormulaSection) => ({
    id,
    active: section === id,
    sample: samples?.[id],
  });

  return (
    <>
      {!controlled && (
        <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
          <Sigma className="h-4 w-4" />
          {t('button')}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <Section {...at('visibility')} title={t('visibility.title')}>
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

            <Section {...at('trend')} title={t('trend.title')}>
              <p>{t('trend.body')}</p>
            </Section>

            <Section {...at('mentions')} title={t('mentions.title')}>
              <p>{t('mentions.body')}</p>
            </Section>

            <Section {...at('citations')} title={t('citations.title')}>
              <p>{t('citations.body')}</p>
            </Section>

            <Section {...at('sentiment')} title={t('sentiment.title')}>
              <p>{t('sentiment.body')}</p>
              <Formula>{t('sentiment.formula')}</Formula>
            </Section>

            <Section {...at('position')} title={t('position.title')}>
              <p>{t('position.body')}</p>
              <Formula>{t('position.formula')}</Formula>
            </Section>

            <Section {...at('citationRate')} title={t('citationRate.title')}>
              <p>{t('citationRate.body')}</p>
              <Formula>{t('citationRate.formula')}</Formula>
            </Section>

            <Section {...at('shareOfVoice')} title={t('shareOfVoice.title')}>
              <p>{t('shareOfVoice.body')}</p>
              <Formula>{t('shareOfVoice.formula')}</Formula>
            </Section>

            <Section {...at('coverage')} title={t('coverage.title')}>
              <p>{t('coverage.body')}</p>
              <Formula>{t('coverage.formula')}</Formula>
            </Section>

            <Section {...at('changes')} title={t('changes.title')}>
              <p>{t('changes.body')}</p>
            </Section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
