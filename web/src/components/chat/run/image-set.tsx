'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Download } from 'lucide-react';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';

/** A set as its card reads it: how many images, which is selected (from 1), whose chat. */
interface SetRead {
  count: number;
  selected: number;
  mine: boolean;
}

/** A downloaded image's extension, by its type. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** A title as a file name: "Cover image · GEO 2026" → "cover-image-geo-2026". */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'image';
}

const ACTION =
  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * An image as PNG (CHAT-15 item 22: "PNG" downloads the selected image),
 * drawn on a canvas in the browser: the providers answer in JPEG or PNG,
 * and no image library runs on the server. A browser that can't draw it
 * saves it as it came.
 */
export async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ?? blob;
  } catch {
    return blob;
  }
}

/**
 * The images of a set Chat made (CHAT-15 items 21–22, W4-08), on its output
 * card: each one, the selected one marked (the first, until another is
 * picked), and PNG for the selected one. The person picks another in their
 * own chat; its file in Files becomes that one. The PNG is named after the
 * set's `title`.
 */
export function ImageSet({ runId, n, title }: { runId: string; n: number; title: string }) {
  const t = useTranslations('chatDeliverable.images');
  const base = `/api/chat/runs/${runId}/files/${n}/images`;
  const [set, setSet] = useState<SetRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(base, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (SetRead & { ok?: boolean }) | null;
        if (!live) return;
        if (!res.ok || !body?.ok || !body.count) setFailed(true);
        else setSet({ count: body.count, selected: body.selected, mine: body.mine });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [base]);

  async function pick(image: number) {
    if (!set || !set.mine || busy || image === set.selected) return;
    const before = set.selected;
    setSet({ ...set, selected: image });
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) throw new Error('Not picked');
    } catch {
      setSet((current) => (current ? { ...current, selected: before } : current));
      toast.error(t('pickFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPng() {
    if (!set) return;
    const res = await fetch(`${base}/${set.selected}`).catch(() => null);
    if (!res?.ok) {
      toast.error(t('unreadable'));
      return;
    }
    const blob = await res.blob();
    const type = blob.type || res.headers.get('Content-Type') || '';
    const png = await asPng(blob);
    // Saved as it came when the browser can't draw it: under its own extension.
    const extension = png.type === 'image/png' ? 'png' : (EXTENSIONS[type] ?? 'png');
    const name = `${slugOf(title)}.${extension}`;
    saveBlob(png, name);
    toast(t('downloaded', { name }));
  }

  if (failed) {
    return (
      <p data-slot="image-set-unreadable" className="text-xs text-muted-foreground">
        {t('unreadable')}
      </p>
    );
  }
  if (!set) {
    return (
      <p data-slot="image-set-loading" className="text-xs text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  const images = Array.from({ length: set.count }, (_, i) => i + 1);
  return (
    <div data-slot="image-set" className="flex flex-col gap-2">
      <div
        role={set.mine ? 'radiogroup' : 'group'}
        aria-label={t('label')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {images.map((image) => {
          const selected = image === set.selected;
          return (
            <button
              key={image}
              type="button"
              role={set.mine ? 'radio' : undefined}
              aria-checked={set.mine ? selected : undefined}
              aria-label={t('pick', { n: image, count: set.count })}
              data-image={image}
              data-selected={selected || undefined}
              disabled={!set.mine || busy}
              onClick={() => void pick(image)}
              className={cn(
                'relative overflow-hidden rounded-lg border bg-muted/40 outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
                selected ? 'border-primary ring-2 ring-primary' : 'hover:border-foreground/30',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file, read through its route */}
              <img
                src={`${base}/${image}`}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              {selected && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  <Check className="size-3" aria-hidden />
                  {t('selected')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-action="deliverable.png"
          onClick={() => void downloadPng()}
          className={ACTION}
        >
          <Download className="size-3.5" aria-hidden />
          {t('png')}
        </button>
      </div>
    </div>
  );
}
