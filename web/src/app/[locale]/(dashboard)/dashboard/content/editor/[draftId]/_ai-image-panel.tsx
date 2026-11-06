'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ImageModelOption } from '@/lib/chat/images/access';
import { EDITOR_IMAGE_VARIANTS } from '@/lib/chat/images/models';
import {
  DRAFT_IMAGE_RATIOS,
  DRAFT_IMAGE_STYLES,
  formatShare,
  type DraftImageRatio,
  type DraftImageStyle,
} from '@/lib/content/ai-image-options';
import { cn } from '@/lib/utils';

const CHIP =
  'h-7 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50';
const chipClass = (on: boolean) =>
  cn(CHIP, on ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted');

const COUNTS = Array.from(
  { length: EDITOR_IMAGE_VARIANTS.max - EDITOR_IMAGE_VARIANTS.min + 1 },
  (_, i) => EDITOR_IMAGE_VARIANTS.min + i,
);

/** What a failed request says, by its code. */
type Failure =
  | 'unavailable'
  | 'own_key'
  | 'provider_off'
  | 'ai_limit'
  | 'refused'
  | 'demo'
  | 'storage_full'
  | 'not_saved'
  | 'failed'
  | 'upload';

/** An option the server made and stored: its id and its address. */
interface ImageOption {
  id: string;
  url: string;
}

/**
 * Drops options nobody picked (ai-image-store.ts). Best effort, also on the
 * way out of the page (keepalive); one that is missed stays in the
 * workspace's ai-options folder, linked from no page.
 */
function dropOptions(draftId: string, ids: readonly string[]) {
  if (ids.length === 0) return;
  void fetch(`/api/content/drafts/${draftId}/images/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop: ids }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Generate with AI in the image dialog (CHAT-25 §9, W4-09): the
 * description (filled from the page's title), the style and shape, the
 * image model with how fast it uses the monthly AI limit and its share per
 * image, two to four options; then the options to pick from (stored by the
 * server, shown by their addresses), the alt text (filled from the
 * description) and Use this image, which keeps the picked one and adds it
 * marked as AI's. The others are dropped then, on Regenerate once the new
 * set is in, and when the panel closes. Never a dollar amount.
 */
export function AiImagePanel({
  draftId,
  title,
  onUse,
}: {
  draftId: string;
  title: string;
  onUse: (image: { src: string; alt: string }) => void;
}) {
  const t = useTranslations('contentEditor.editor.image.ai');
  const [prompt, setPrompt] = useState(() => t('promptDefault', { title: title.trim() || '…' }));
  const [style, setStyle] = useState<DraftImageStyle>('brand');
  const [ratio, setRatio] = useState<DraftImageRatio>('16:9');
  const [models, setModels] = useState<ImageModelOption[] | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [count, setCount] = useState<number>(EDITOR_IMAGE_VARIANTS.min);
  const [images, setImages] = useState<ImageOption[]>([]);
  // Made and charged, but not stored: said beside the options.
  const [unsaved, setUnsaved] = useState(0);
  const [selected, setSelected] = useState(0);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState<'generate' | 'use' | null>(null);
  const [failure, setFailure] = useState<{
    code: Failure;
    why?: string;
    /** The image model's label, when its maker is turned off. */
    model?: string;
    /** How many images the request asked for, or were made: what the message counts. */
    count?: number;
  } | null>(null);
  // The options not yet kept or dropped, for the drop when the panel closes.
  const open = useRef<string[]>([]);

  useEffect(() => {
    const drop = () => {
      dropOptions(draftId, open.current);
      open.current = [];
    };
    window.addEventListener('pagehide', drop);
    return () => {
      window.removeEventListener('pagehide', drop);
      drop();
    };
  }, [draftId]);

  useEffect(() => {
    let live = true;
    fetch(`/api/content/drafts/${draftId}/images`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          models?: ImageModelOption[];
          ownKey?: boolean;
        } | null;
        if (!live) return;
        if (!res.ok || !body?.ok || !body.models?.length) {
          setFailure({ code: 'unavailable' });
          return;
        }
        setModels(body.models);
        setOwnKey(body.ownKey === true);
        setModel(body.models.find((m) => m.recommended)?.id ?? body.models[0].id);
      })
      .catch(() => live && setFailure({ code: 'unavailable' }));
    return () => {
      live = false;
    };
  }, [draftId]);

  const picked = models?.find((m) => m.id === model) ?? null;
  const share =
    picked?.sharePercent !== null && picked?.sharePercent !== undefined && !ownKey
      ? t('share', { percent: formatShare(picked.sharePercent * count) })
      : null;

  async function generate() {
    if (!model || busy) return;
    setBusy('generate');
    setFailure(null);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style, aspectRatio: ratio, model, count }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        images?: ImageOption[];
        failed?: number;
        code?: string;
        why?: string;
        model?: string;
        made?: number;
      } | null;
      if (res.ok && body?.ok && body.images?.length) {
        // The earlier set goes once the new one is in: until then it can still be used.
        dropOptions(draftId, open.current);
        open.current = body.images.map((image) => image.id);
        setImages(body.images);
        setUnsaved(body.failed ?? 0);
        setSelected(0);
        setAlt((current) => current || prompt.slice(0, 200));
        return;
      }
      const code = (
        [
          'unavailable',
          'own_key',
          'provider_off',
          'ai_limit',
          'refused',
          'demo',
          'storage_full',
          'not_saved',
        ] as const
      ).find((c) => c === body?.code);
      setFailure({
        code: code ?? 'failed',
        why: body?.why,
        model: body?.model,
        count: code === 'not_saved' ? (body?.made ?? count) : count,
      });
    } catch {
      setFailure({ code: 'failed' });
    } finally {
      setBusy(null);
    }
  }

  async function use() {
    const image = images[selected];
    if (!image || busy) return;
    setBusy('use');
    setFailure(null);
    try {
      // Kept where an upload goes, the others dropped: nothing goes up again.
      const res = await fetch(`/api/content/drafts/${draftId}/images/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keep: image.id,
          drop: open.current.filter((id) => id !== image.id),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
      if (!res.ok || !body?.ok || !body.url) {
        setFailure({ code: 'upload' });
        return;
      }
      open.current = [];
      onUse({ src: body.url, alt: alt.trim() });
    } catch {
      setFailure({ code: 'upload' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-slot="ai-image-panel" className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ai-image-prompt">{t('prompt')}</Label>
        <Textarea
          id="ai-image-prompt"
          value={prompt}
          rows={3}
          maxLength={1000}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('rules')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label={t('style')} className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">{t('style')}</span>
          {DRAFT_IMAGE_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              data-style={s}
              aria-pressed={style === s}
              onClick={() => setStyle(s)}
              className={chipClass(style === s)}
            >
              {t(`styles.${s}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('ratio')} className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">{t('ratio')}</span>
          {DRAFT_IMAGE_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              data-ratio={r}
              aria-pressed={ratio === r}
              onClick={() => setRatio(r)}
              className={chipClass(ratio === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {!models && !failure && (
        <p data-slot="ai-image-models-loading" className="text-xs text-muted-foreground">
          {t('loadingModels')}
        </p>
      )}
      {models && (
        <div role="radiogroup" aria-label={t('model')} className="space-y-1">
          <span className="text-xs text-muted-foreground">{t('model')}</span>
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={model === m.id}
              data-model={m.id}
              onClick={() => setModel(m.id)}
              className={cn(
                'flex w-full items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                model === m.id ? 'border-foreground bg-muted/40' : 'bg-card hover:bg-muted/40',
              )}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {m.label}
                  {m.recommended && (
                    <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-950/40 dark:text-green-300">
                      {t('recommended')}
                    </span>
                  )}
                </span>
                {m.multiplier && (
                  <span className="block text-xs text-muted-foreground">
                    {ownKey || m.sharePercent === null
                      ? t('modelOwnKey', { multiplier: m.multiplier })
                      : t('modelCost', {
                          multiplier: m.multiplier,
                          percent: formatShare(m.sharePercent),
                        })}
                  </span>
                )}
              </span>
              {model === m.id && <Check aria-hidden className="mt-0.5 size-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('count')} className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">{t('count')}</span>
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              data-count={n}
              aria-pressed={count === n}
              onClick={() => setCount(n)}
              className={chipClass(count === n)}
            >
              {n}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant={images.length ? 'outline' : 'default'}
          className="ml-auto gap-1.5"
          data-action="ai-image.generate"
          disabled={!model || busy !== null || prompt.trim().length < 3}
          onClick={() => void generate()}
        >
          <Sparkles aria-hidden className="size-3.5" />
          {busy === 'generate'
            ? t('generating')
            : images.length
              ? t('regenerate')
              : t('generate', { count })}
        </Button>
      </div>
      {share && <p className="text-right text-xs text-muted-foreground">{share}</p>}

      {failure && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t(`failed.${failure.code}`, {
            why: failure.why ?? '',
            model: failure.model ?? '',
            count: failure.count ?? count,
          })}
        </p>
      )}

      {images.length > 0 && (
        <div className="space-y-2">
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {images.map((image, i) => (
              <button
                key={image.id}
                type="button"
                role="radio"
                aria-checked={selected === i}
                aria-label={t('pick', { n: i + 1, count: images.length })}
                data-option={i + 1}
                onClick={() => setSelected(i)}
                className={cn(
                  'relative overflow-hidden rounded-lg border bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  selected === i
                    ? 'border-primary ring-2 ring-primary'
                    : 'hover:border-foreground/30',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- an option just stored, by its address */}
                <img src={image.url} alt="" className="aspect-video w-full object-cover" />
                {selected === i && (
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    <Check className="size-3" aria-hidden />
                    {t('selected')}
                  </span>
                )}
              </button>
            ))}
          </div>
          {unsaved > 0 && (
            <p data-slot="ai-image-unsaved" className="text-xs text-muted-foreground">
              {t('unsaved', { count: unsaved })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ai-image-alt">{t('alt')}</Label>
            <Input
              id="ai-image-alt"
              value={alt}
              maxLength={300}
              onChange={(e) => setAlt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('altHint')}</p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              data-action="ai-image.use"
              disabled={busy !== null || !alt.trim()}
              onClick={() => void use()}
            >
              {busy === 'use' ? t('uploading') : t('use')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
