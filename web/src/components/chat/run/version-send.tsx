'use client';

import { useEffect, useState } from 'react';
import { SendDialog } from '@/components/content/send-to-cms-dialog';
import { useRouter } from '@/i18n/navigation';
import { getContentDraft } from '@/lib/actions/content-drafts';
import type { CmsSource } from '@/lib/content/cms-send';
import { readCmsSources } from '@/lib/content/cms-sources';
import { useBrandStore } from '@/stores/use-brand-store';

/**
 * A version card's Send to CMS (CHAT-25 §6, W4-12b): the page made ready as
 * the Library makes it for its own Send (readCmsSources: its author, byline,
 * and the slug and meta it kept), in the draft's own brand whichever brand
 * the chat is about, then the Library's Send dialog. A page that can't be
 * read closes it, and the card says so (onFailed).
 */
export function VersionSendDialog({
  draftId,
  href,
  onFailed,
  onClose,
}: {
  draftId: string;
  /** The page in the editor, where its placeholders are filled. */
  href: string;
  onFailed: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const brands = useBrandStore((state) => state.brands);
  const [sending, setSending] = useState<{ brandId: string; source: CmsSource } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContentDraft(draftId)
      .then(async (draft) => {
        if (!draft) return null;
        const brand = brands.find((b) => b.id === draft.brandId);
        const sources = await readCmsSources({
          brandId: draft.brandId,
          draftIds: [draftId],
          brandName: brand?.name ?? '',
          brandLanguage: brand?.language,
        });
        const page = sources.get(draftId);
        return page ? { brandId: draft.brandId, source: page } : null;
      })
      .catch((err: unknown) => {
        console.error('Failed to read the page to send:', err);
        return null;
      })
      .then((read) => {
        if (cancelled) return;
        if (read) {
          setSending(read);
        } else {
          onFailed();
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
    // Read once, as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  if (!sending) return null;
  return (
    <SendDialog
      draftId={sending.source.draftId}
      brandId={sending.brandId}
      title={sending.source.title}
      html={sending.source.html}
      sourceUrl={sending.source.sourceUrl}
      author={sending.source.author}
      reviewer={sending.source.reviewer}
      teamByline={sending.source.teamByline}
      byline={sending.source.byline}
      // Placeholders are filled in the editor.
      onFillNow={() => router.push(href)}
      onClose={onClose}
    />
  );
}
