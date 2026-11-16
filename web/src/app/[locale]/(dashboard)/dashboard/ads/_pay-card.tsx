'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useChatPanel } from '@/components/chat/panel/chat-panel-context';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import type { AdsAdDraft, AdsOpportunity } from '@/lib/ads/api';
import { brandFactsPath } from '@/lib/content/brand-facts';
import { cn } from '@/lib/utils';
import type { AdsFailure, AdsHalf } from './_do-both';

/** A draft's ad text, as copied and as Chat is asked to rewrite it: one field a line. */
const adText = (d: AdsAdDraft) => [...d.headlines, ...d.descriptions].join('\n');

/** What a failed Create says (§9.5), from the API's code and facts_needed's `why`. */
function failure({ code, why }: AdsFailure) {
  if (code === 'facts_needed') return why === 'off' ? 'factsOff' : 'factsNeeded';
  return code === 'gate_failed' ? 'gateFailed' : code === 'ai_budget' ? 'aiBudget' : 'failed';
}

/**
 * The drawer's Pay card (ADS-01 §3.2, mockup), for Pay and Earn + pay: the
 * saved drafts, ChatGPT, Google, Microsoft, each with its gate result, Copy
 * and, for those who can write, Edit, which asks Chat to rewrite it. A
 * channel's name scrolls to its draft. Without drafts, Create (`half`, "Do
 * both"'s Pay half) for those who can write, saying why when refused. The
 * words are the model's: React text only, never HTML.
 */
export function AdsPayCard({
  row,
  brandId,
  drafts,
  canCreate,
  half,
  onLeave,
}: {
  row: AdsOpportunity;
  brandId: string;
  drafts: AdsAdDraft[];
  canCreate: boolean;
  half: AdsHalf<unknown>;
  /** Closes the drawer, so the Chat panel Edit opens shows. */
  onLeave: () => void;
}) {
  const t = useTranslations('ads.drawer.pay');
  const tChannel = useTranslations('ads.opportunities.channels');
  const panel = useChatPanel();
  const card = useRef<HTMLElement>(null);
  if (row.decision !== 'pay' && row.decision !== 'earn_pay') return null;

  const copy = async (d: AdsAdDraft) => {
    try {
      await navigator.clipboard.writeText(adText(d));
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  const edit =
    canCreate && panel?.available
      ? (d: AdsAdDraft) => {
          const ask = t('editAsk', {
            channel: tChannel(d.channel),
            prompt: row.text,
            ad: adText(d),
          });
          // `/ad-drafts` once Chat has that skill (PR 15); a plain request until then.
          const skill = panel.setup.skills.some((s) => s.name === 'ad-drafts');
          panel.fill(skill ? `/ad-drafts ${ask}` : ask);
          if (!panel.open) panel.toggle();
          onLeave();
        }
      : null;
  const scrollTo = (channel: string) =>
    card.current
      ?.querySelector(`[data-channel="${channel}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const failed = half.failed && failure(half.failed);

  return (
    <section ref={card} data-slot="ads-pay" className="mt-3 space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="flex-1 font-semibold">{t('title')}</h3>
        {drafts.length > 1 &&
          drafts.map((d) => (
            <Button
              key={d.channel}
              size="xs"
              variant="ghost"
              data-action="ads.scrollAds"
              aria-label={t('see', { channel: tChannel(d.channel) })}
              onClick={() => scrollTo(d.channel)}
            >
              {tChannel(d.channel)}
            </Button>
          ))}
      </div>
      {drafts.length === 0 ? (
        <>
          <p className="text-muted-foreground">{t(canCreate ? 'intro' : 'none')}</p>
          {failed && <p role="alert">{t(failed)}</p>}
          <div className="flex flex-wrap gap-1.5">
            {failed === 'factsNeeded' && (
              <Link
                href={brandFactsPath(brandId)}
                data-action="ads.openBrandFacts"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                {t('factsLink')}
              </Link>
            )}
            {canCreate && (
              <Button
                size="sm"
                variant="outline"
                data-action="ads.createDrafts"
                disabled={half.busy}
                onClick={() => void half.run()}
              >
                {t(half.busy ? 'creating' : failed ? 'retry' : 'create')}
              </Button>
            )}
          </div>
        </>
      ) : (
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li
              key={d.id}
              data-slot="ads-draft"
              data-channel={d.channel}
              className="space-y-1 rounded-lg border p-3"
            >
              <p className="text-xs text-muted-foreground">
                {t('channel', { channel: d.channel })}
              </p>
              <p className="font-semibold">{d.headlines.join(' | ')}</p>
              {d.descriptions.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {d.contextHint && (
                <p className="text-xs text-muted-foreground">
                  {t('hint', { hint: d.contextHint })}
                </p>
              )}
              <p data-slot="ads-gate" className="text-xs text-muted-foreground">
                {t('checked')}
                {d.gate.limits === 'unconfirmed' && ` · ${t('limits')}`}
              </p>
              <div className="flex gap-1.5 pt-1">
                <Button
                  size="xs"
                  variant="outline"
                  data-action="ads.copyAd"
                  onClick={() => void copy(d)}
                >
                  {t('copy')}
                </Button>
                {edit && (
                  <Button
                    size="xs"
                    variant="outline"
                    data-action="ads.editAd"
                    onClick={() => edit(d)}
                  >
                    {t('edit')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
