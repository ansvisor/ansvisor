'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  articleJsonLd,
  isArticlePage,
  itemListJsonLd,
  MIN_LISTED,
  productJsonLd,
  type ListedProduct,
  type PageOfferRead,
  jsonLdScript,
  localDate,
  offerText,
  pageName,
  titleHasPlaceholder,
} from '@/lib/content/page-schema';
import { qualityPhase } from '@/lib/content/quality';
import { checksOff } from '@/lib/content/quality-profiles';
import { listed, type CardPrice, type ShoppingLinks } from '@/lib/content/shopping-check';
import { cn } from '@/lib/utils';
import { copyToClipboard } from './_html-block';
import { trustSuggestions, type QualityRead } from './_quality-tab';

/** Trust under this warns before the page is marked ready (Quality spec §7). */
export const TRUST_GATE = 60;

/** The warning's facts, logged when the page is marked ready anyway. */
export interface ReadyAnyway {
  trust: number;
  /** The Trust check the warning named, and how many it counted. */
  reason: string | null;
  count: number | null;
}

type RowState = 'ok' | 'missing' | 'check';
type Row = {
  state: RowState;
  title: string;
  detail: string;
  /** Ready to paste's Fill now, while a placeholder is open. */
  fill?: boolean;
  /** The disclosure's Add line (CE-050): the line it puts under the H1. */
  add?: string;
};

/** What Ready to paste reads (Quality spec §7b): placeholders, alt text, links. */
export interface ReadyToPaste {
  placeholders: number;
  imagesWithoutAlt: number;
  linksBroken: number;
  /** Links with no read yet, or none to come: no word on whether they work. */
  linksUnread: number;
}

/**
 * Before you publish (Content Editor Quality spec §7, CE-041), on Mark
 * ready and on Export (§7b, CE-057): a warning only when Trust is under 60
 * (nothing else blocks), what the CMS does for the page (its author, dates
 * and schema), Ready to paste (no placeholders, images with alt text, links
 * that work), and for an article the JSON-LD to paste when the CMS doesn't
 * write one, from the page's facts only. Mark ready anyway is logged with
 * the Trust the page had; on Export it goes on to Export, and on Send to CMS
 * to the Send dialog (#1331). Rendered only while open.
 *
 * On Send to CMS, a page with nothing to ask about (Trust read and 60 or
 * more, the authors and a category's products read, nothing missing,
 * nothing still being read) goes straight on to the Send dialog, and the
 * code, for a CMS that doesn't write it, is folded away.
 */
/** The below-60 warning, as each way on says what it does. */
const WARNING = { markReady: 'warning', export: 'warningExport', send: 'warningSend' } as const;
const WARNING_NO_REASON = {
  markReady: 'warningNoReason',
  export: 'warningNoReasonExport',
  send: 'warningNoReasonSend',
} as const;

export function BeforePublish({
  mode = 'markReady',
  paste,
  onFillNow,
  contentByline = null,
  onContinue,
  onClose,
  quality,
  title,
  isNew,
  pageType,
  image,
  linksPending,
  onMarkReady,
  onFixFirst,
  disclosureLine = null,
  disclosureAdded = false,
  onAddDisclosure,
  product = null,
  category = null,
  shopping = null,
}: {
  /**
   * The page's shopping links against the catalog now (shopping path, part
   * 6): the products that no longer sell, the category page, the products
   * linked; 'reading' while it's read again, 'failed' when it couldn't be;
   * null on a page without a shopping path.
   */
  shopping?: ShoppingLinks | 'reading' | 'failed' | null;
  /**
   * Phase 3 (CE-053): a product page's Product schema, from its opening
   * paragraph, its images and the price it states (pageOffer); null on
   * other pages.
   */
  product?: { description: string | null; images: string[]; offer: PageOfferRead } | null;
  /**
   * Phase 3 (CE-054): a category page's ItemList, from its links to the
   * brand's product pages (listedProducts); null on other pages.
   */
  category?: { items: ListedProduct[]; status: 'read' | 'reading' | 'unknown' } | null;
  /** Opened by Mark ready, by Export, or by Send to CMS. */
  mode?: 'markReady' | 'export' | 'send';
  paste: ReadyToPaste;
  /** Goes to the first placeholder, to fill it (Ready to paste's Fill now). */
  onFillNow: () => void;
  /** The byline line the brand puts in the content (Add byline to content), or null. */
  contentByline?: string | null;
  /** Export's and Send's: goes on to them. */
  onContinue?: () => void;
  onClose: () => void;
  quality: QualityRead;
  title: string;
  /** A new page; an optimized one is already live, with its published date. */
  isNew: boolean;
  pageType: string | null;
  /** The page's own image (firstImage). */
  image: string | null;
  /** The page's links whose read may still come: Trust may change. */
  linksPending: number;
  /** Marks it ready: with the warning's facts when past it. */
  onMarkReady: (anyway: ReadyAnyway | null) => void;
  /** Goes to what would raise Trust, the passage named first. */
  onFixFirst: (show: string | null) => void;
  /**
   * Phase 2 (CE-050): the disclosure line in the page's language
   * (disclosureText), or null where there's none to offer.
   */
  disclosureLine?: string | null;
  /** The page has that line already: added, and not read again yet. */
  disclosureAdded?: boolean;
  /** Puts the disclosure line under the page's opening paragraph (undoable, as any edit). */
  onAddDisclosure?: (line: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.beforePublish');
  const tQuality = useTranslations('contentEditor.editor.quality');
  const markRef = useRef<HTMLButtonElement>(null);
  // Fix first and Fill now move on to the page: focus isn't sent back to the button.
  const fixing = useRef(false);
  const { author, brandName, siteTrust } = quality;
  // E-E-A-T is read with the authors: until then, who the page is by isn't known.
  const authorsRead = quality.eeat !== null;
  const trust = quality.trust?.score ?? null;
  const below = trust !== null && trust < TRUST_GATE;
  // The biggest of what would raise Trust: the warning's reason. The claims
  // a proof to-do covers count here too: the warning names them.
  const [fix] = below
    ? trustSuggestions(tQuality, quality.trust, undefined, {
        balanced: quality.aiChecks?.balanced ?? null,
        disclosure: quality.aiChecks?.disclosure ?? null,
        brand: quality.brandName,
      })
        .filter((s) => s.gain > 0)
        .sort((a, b) => b.gain - a.gain)
    : [];
  const article = !product && !category && isArticlePage(pageType);
  // Product needs its name and price: without either, no code to paste.
  const productName = pageName(title);
  const offer = product?.offer && !('several' in product.offer) ? product.offer : null;
  const productLd =
    product &&
    offer &&
    productName &&
    jsonLdScript(
      productJsonLd({
        name: productName,
        description: product.description,
        images: product.images,
        brandName,
        offer,
      }),
    );
  // An ItemList lists two products at least: one isn't a list.
  const itemListLd =
    category?.status === 'read' &&
    category.items.length >= MIN_LISTED &&
    jsonLdScript(itemListJsonLd({ name: productName, items: category.items }));
  const jsonLd = productLd
    ? productLd
    : itemListLd
      ? itemListLd
      : article
        ? jsonLdScript(
            articleJsonLd({
              title,
              // An author only confirmed (00271) isn't named here: left out, as unknown.
              author:
                authorsRead && !(!author && quality.authorConfirmed?.real) ? author : undefined,
              authorUrl:
                (author &&
                  siteTrust?.checks.authorPages.authors.find((a) => a.name === author.name)?.url) ||
                null,
              brandName,
              brandUrl: siteTrust?.checks.organizationSchema.url ?? null,
              image,
              isNew,
              today: localDate(new Date()),
            }),
          )
        : null;
  // Added here: it counts once the page is read again.
  const [added, setAdded] = useState(false);
  // Where the page's type counts it (CE-052): a product page is the brand's own.
  const disclosure =
    quality.weightsFor && checksOff(quality.weightsFor.profile).has('disclosure')
      ? null
      : (quality.aiChecks?.disclosure ?? null);
  const brand = quality.brandName || tQuality('yourBrand');
  const rows: Row[] = [
    !authorsRead
      ? { state: 'check', title: t('author.ok'), detail: t('author.unknown') }
      : author
        ? {
            state: 'check',
            title: contentByline ? t('author.inContentTitle') : t('author.ok'),
            detail: contentByline
              ? t('author.inContent', { line: contentByline })
              : t('author.okDetail', { name: author.name }),
          }
        : quality.authorConfirmed?.real
          ? // The person confirmed the author their site names (00271).
            { state: 'check', title: t('author.confirmed'), detail: t('author.confirmedDetail') }
          : quality.weightsFor && checksOff(quality.weightsFor.profile).has('byline')
            ? // A page type that goes out under the brand (CE-052): a product page.
              {
                state: 'check',
                title: t('author.brand'),
                detail: t('author.brandDetail', { byline: quality.team }),
              }
            : {
                state: 'missing',
                title: t('author.none'),
                detail: t('author.noneDetail', { byline: quality.team }),
              },
    ...(product
      ? productLd
        ? [
            {
              state: 'check' as const,
              title: t('schema.product'),
              detail: t('schema.productDetail', { price: offerText(offer!) }),
            },
          ]
        : [
            ...(productName
              ? []
              : [
                  {
                    state: 'missing' as const,
                    title: t('schema.productNoName'),
                    detail: t('schema.productNoNameDetail'),
                  },
                ]),
            ...(offer
              ? []
              : [
                  product.offer && 'several' in product.offer
                    ? {
                        state: 'missing' as const,
                        title: t('schema.productSeveral'),
                        detail: t('schema.productSeveralDetail', {
                          prices: product.offer.several.join(', '),
                        }),
                      }
                    : {
                        state: 'missing' as const,
                        title: t('schema.productNoPrice'),
                        detail: t('schema.productNoPriceDetail'),
                      },
                ]),
          ]
      : category
        ? [
            category.status !== 'read'
              ? {
                  state: 'check' as const,
                  title: t('schema.itemListTitle'),
                  detail: t(
                    category.status === 'reading'
                      ? 'schema.itemListReading'
                      : 'schema.itemListUnknown',
                  ),
                }
              : itemListLd
                ? {
                    state: 'check' as const,
                    title: t('schema.itemList', { count: category.items.length }),
                    detail: t('schema.itemListDetail'),
                  }
                : {
                    state: 'missing' as const,
                    title: t('schema.itemListNone'),
                    detail: t('schema.itemListNoneDetail', { count: category.items.length }),
                  },
          ]
        : article
          ? [
              { state: 'check' as const, title: t('dates.title'), detail: t('dates.detail') },
              isNew
                ? { state: 'check' as const, title: t('schema.title'), detail: t('schema.detail') }
                : {
                    state: 'check' as const,
                    title: t('schema.titleLive'),
                    detail: t('schema.detailLive'),
                  },
            ]
          : [
              {
                state: 'check' as const,
                title: t('schema.other'),
                // Phase 3 gives product and category pages their code too.
                detail: t(qualityPhase() >= 3 ? 'schema.otherDetailTyped' : 'schema.otherDetail'),
              },
            ]),
    // Phase 2 (CE-050): where the page puts the brand forward.
    ...(disclosure
      ? [
          disclosure.found && !disclosure.added
            ? {
                state: 'ok' as const,
                title: t('disclosure.ok'),
                detail: disclosure.show
                  ? t('disclosure.okDetail', { line: disclosure.show })
                  : t('disclosure.okReading'),
              }
            : added || disclosureAdded
              ? {
                  state: 'check' as const,
                  title: t('disclosure.added'),
                  detail: t('disclosure.addedDetail'),
                }
              : {
                  state: 'missing' as const,
                  title: t('disclosure.none', { brand }),
                  detail: disclosureLine
                    ? t('disclosure.noneDetail', { line: disclosureLine })
                    : t('disclosure.noneWrite', { brand }),
                  ...(disclosureLine && onAddDisclosure ? { add: disclosureLine } : {}),
                },
        ]
      : []),
    ...(shopping ? [shoppingRow(t, shopping)] : []),
    ...(typeof shopping === 'object' && shopping?.prices?.length
      ? [cardPricesRow(t, shopping.prices)]
      : []),
    { ...readyRow(t, paste, linksPending), fill: paste.placeholders > 0 },
  ];
  // Nothing to ask about as Send opens it: straight on to the Send dialog.
  // Only once all is read: Trust, the authors, a category's products and the
  // shopping links not read yet may still have something to ask. A Trust
  // read with no score has nothing to score (no figure, no dated source):
  // nothing to ask.
  const [skipped] = useState(
    () =>
      mode === 'send' &&
      quality.trust !== null &&
      !below &&
      authorsRead &&
      category?.status !== 'reading' &&
      shopping !== 'reading' &&
      rows.every((row) => row.state !== 'missing') &&
      linksPending === 0 &&
      !quality.claimsReading &&
      !quality.pageReading,
  );
  // Once, as it opens: StrictMode runs an effect twice, and the Send dialog opens once.
  const continued = useRef(false);
  useEffect(() => {
    if (!skipped || continued.current) return;
    continued.current = true;
    onContinue?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it opens
  }, [skipped]);
  // The page goes to the CMS: the code is only for one that doesn't write it.
  const [codeShown, setCodeShown] = useState(mode !== 'send');
  const codeId = useId();
  const codeRef = useRef<HTMLPreElement>(null);
  // Show the JSON-LD takes the focus to the code it opens.
  const focusCode = useRef(false);
  useEffect(() => {
    if (!codeShown || !focusCode.current) return;
    focusCode.current = false;
    codeRef.current?.focus();
  }, [codeShown]);
  if (skipped) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        initialFocus={markRef}
        finalFocus={() => !fixing.current}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        {below && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>
                {fix
                  ? t(WARNING[mode], {
                      trust,
                      reason: fix.line,
                      count: fix.count,
                      raised: trust + fix.gain,
                    })
                  : t(WARNING_NO_REASON[mode], {
                      trust,
                    })}
              </p>
              {mode === 'markReady' && <p className="text-xs opacity-80">{t('logged')}</p>}
            </div>
          </div>
        )}
        {linksPending > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {t('linksPending', { count: linksPending })}
          </p>
        )}
        {quality.claimsReading && (
          <p role="status" className="text-xs text-muted-foreground">
            {t('claimsReading')}
          </p>
        )}
        {quality.pageReading && (
          <p role="status" className="text-xs text-muted-foreground">
            {t('pageReading')}
          </p>
        )}
        <ul className="divide-y rounded-xl border text-sm">
          {rows.map((row) => (
            <li key={row.title} className="flex items-start gap-2.5 px-3 py-2.5">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  row.state === 'ok'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : row.state === 'missing'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {row.state === 'ok' ? (
                  <Check className="h-3 w-3" />
                ) : row.state === 'missing' ? (
                  '!'
                ) : (
                  '?'
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {row.title}
                  <span className="sr-only">
                    {' · '}
                    {t(`states.${row.state}`)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {row.detail}
                </p>
              </div>
              {row.fill && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    fixing.current = true;
                    onFillNow();
                  }}
                >
                  {t('paste.fill')}
                </Button>
              )}
              {row.add && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    onAddDisclosure?.(row.add!);
                    setAdded(true);
                  }}
                >
                  {t('disclosure.add')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {jsonLd && (
          <div className="space-y-1.5">
            {mode === 'send' && (
              <button
                type="button"
                aria-expanded={codeShown}
                aria-controls={codeShown ? codeId : undefined}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  focusCode.current = !codeShown;
                  setCodeShown(!codeShown);
                }}
              >
                <ChevronDown
                  aria-hidden
                  className={cn('h-3.5 w-3.5 transition-transform', !codeShown && '-rotate-90')}
                />
                {t('showCode')}
              </button>
            )}
            {codeShown && (
              <pre
                id={codeId}
                ref={codeRef}
                aria-label={t('jsonLd')}
                tabIndex={0}
                className="max-h-48 overflow-auto rounded-xl border bg-muted/40 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
              >
                {jsonLd}
              </pre>
            )}
            {/* Said folded too: the code that goes, or is copied, leaves it out. */}
            {(article || itemListLd) && titleHasPlaceholder(title) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t(itemListLd ? 'nameLeftOut' : 'headlineLeftOut')}
              </p>
            )}
            {codeShown && (
              <p className="text-xs text-muted-foreground">
                {t(productLd ? 'productNote' : itemListLd ? 'itemListNote' : 'datesNote')}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {jsonLd ? (
            <Button
              variant="outline"
              onClick={() => void copyToClipboard(jsonLd, t('copied'), t('copyFailed'))}
            >
              {t('copy')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {below && (
              <Button
                variant="outline"
                onClick={() => {
                  fixing.current = true;
                  onFixFirst(fix?.show ?? null);
                }}
              >
                {t('fixFirst')}
              </Button>
            )}
            {mode !== 'markReady' ? (
              <Button ref={markRef} onClick={onContinue}>
                {mode === 'send' ? t('continueSend') : t('continueExport')}
              </Button>
            ) : (
              <Button
                ref={markRef}
                onClick={() =>
                  onMarkReady(
                    below ? { trust, reason: fix?.check ?? null, count: fix?.count ?? null } : null,
                  )
                }
              >
                {below ? t('markReadyAnyway') : t('markReady')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type T = ReturnType<typeof useTranslations<'contentEditor.editor.beforePublish'>>;

/**
 * Ready to paste (§7b): no placeholders, every image with alt text, every
 * link working; what is still open, named, or the links not all read yet.
 */
function readyRow(t: T, paste: ReadyToPaste, linksPending: number): Row {
  // The reads still coming are for some of the unread links at most: one the
  // site refused, one past the reads' limit or one in an HTML block gets none.
  const reading = Math.min(linksPending, paste.linksUnread);
  const notRead = paste.linksUnread - reading;
  const unread =
    reading && notRead
      ? t('paste.readingAndUnread', { reading, unread: notRead })
      : reading
        ? t('paste.reading', { count: reading })
        : notRead
          ? t('paste.unreadShort', { count: notRead })
          : null;
  const open = [
    paste.placeholders && t('paste.placeholders', { count: paste.placeholders }),
    paste.imagesWithoutAlt && t('paste.alt', { count: paste.imagesWithoutAlt }),
    paste.linksBroken && t('paste.broken', { count: paste.linksBroken }),
  ].filter((item): item is string => !!item);
  if (open.length) {
    return {
      state: 'missing',
      title: t('paste.notYet'),
      detail: [...open, ...(unread ? [unread] : [])].join(' · '),
    };
  }
  if (unread) {
    return {
      state: 'check',
      title: t('paste.title'),
      detail: t('paste.unread', { links: unread }),
    };
  }
  return { state: 'ok', title: t('paste.title'), detail: t('paste.ok') };
}

/**
 * The product cards that show a price the catalog no longer has (#1610): a
 * card's price is written when it goes in. Put in again, it shows today's.
 */
function cardPricesRow(t: T, prices: CardPrice[]): Row {
  const { shown, more } = listed(prices);
  return {
    state: 'check',
    title: t('shopping.prices', { count: prices.length }),
    detail: t('shopping.pricesDetail', {
      list: shown
        .map((p) => t('shopping.priceItem', { title: p.title, page: p.page, now: p.now ?? 'none' }))
        .join('; '),
      more,
    }),
  };
}

/**
 * The shopping links' row (shopping path, part 6): the products the page
 * links that no longer sell, by name, to remove or replace on the page;
 * else a missing link to the category page; else too few products linked;
 * else how many work. While the catalog is read, or when it can't be, a
 * check of its own.
 */
function shoppingRow(t: T, shopping: ShoppingLinks | 'reading' | 'failed'): Row {
  if (shopping === 'reading' || shopping === 'failed') {
    return { state: 'check', title: t('shopping.title'), detail: t(`shopping.${shopping}`) };
  }
  if (shopping.bad.length) {
    const { shown, more } = listed(shopping.bad);
    return {
      state: 'missing',
      title: t('shopping.bad', { count: shopping.bad.length }),
      detail: t('shopping.badDetail', {
        list: shown.map((p) => t('shopping.item', { title: p.title, state: p.state })).join(', '),
        more,
      }),
    };
  }
  if (shopping.categories > 0 && !shopping.categoryLinked) {
    return {
      state: 'missing',
      title: t('shopping.noCategory'),
      detail: t('shopping.noCategoryDetail'),
    };
  }
  if (shopping.linked.length < shopping.want) {
    return {
      state: 'missing',
      title: t('shopping.few', { count: shopping.linked.length, want: shopping.want }),
      detail: t('shopping.fewDetail'),
    };
  }
  return {
    state: 'ok',
    title: t('shopping.ok'),
    detail: t('shopping.okDetail', {
      count: shopping.linked.length,
      category: shopping.categoryLinked ? 'yes' : 'no',
      // Accepted by Merchant Center is said only where it was read.
      merchantCenter: shopping.merchantCenter ? 'yes' : 'no',
    }),
  };
}
