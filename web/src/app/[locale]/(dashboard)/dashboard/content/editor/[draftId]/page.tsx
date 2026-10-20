'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { getContentDraft } from '@/lib/actions/content-drafts';
import { CONTENT_LIBRARY_PATH, type ContentDraft } from '@/lib/content/drafts';
import { useBrandStore } from '@/stores/use-brand-store';
import { DraftEditor } from './_draft-editor';

type DraftRead = { id: string; draft: ContentDraft } | { id: string; draft: null; failed: boolean };

/**
 * A draft in the editor (Content Editor, CE-004), opened from the Library.
 * Full height, as Chat is: the editor scrolls inside, under its header.
 */
export default function ContentEditorPage() {
  const t = useTranslations('contentEditor.editor');
  const { draftId } = useParams<{ draftId: string }>();
  const [read, setRead] = useState<DraftRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const brands = useBrandStore((s) => s.brands);
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);

  useEffect(() => {
    let cancelled = false;
    getContentDraft(draftId)
      .then((draft) => {
        if (cancelled) return;
        setRead(draft ? { id: draftId, draft } : { id: draftId, draft: null, failed: false });
      })
      .catch((err) => {
        console.error('Failed to open the draft:', err);
        if (!cancelled) setRead({ id: draftId, draft: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, attempt]);

  // A draft opened from a link to another of the member's brands: the
  // sidebar follows it, so the rest of the app shows the same brand.
  const draftBrandId = read?.draft?.brandId;
  useEffect(() => {
    if (
      draftBrandId &&
      draftBrandId !== activeBrandId &&
      brands.some((b) => b.id === draftBrandId)
    ) {
      setActiveBrand(draftBrandId);
    }
  }, [draftBrandId, activeBrandId, brands, setActiveBrand]);

  const current = read?.id === draftId ? read : null;

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col md:h-screen">
      {!current ? (
        <div className="flex flex-1 items-center justify-center" aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : current.draft ? (
        <DraftEditor key={current.draft.id} draft={current.draft} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            {current.failed ? t('loadError') : t('notFound')}
          </p>
          <div className="flex gap-2">
            {current.failed && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRead(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retryLoad')}
              </Button>
            )}
            <Link
              href={CONTENT_LIBRARY_PATH}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('back')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
