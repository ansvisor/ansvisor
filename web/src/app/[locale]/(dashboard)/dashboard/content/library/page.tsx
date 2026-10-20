'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewContentDialog } from '@/components/content/new-content-dialog';
import { getContentDrafts } from '@/lib/actions/content-drafts';
import {
  LIBRARY_TABS,
  draftsInTab,
  libraryTabCounts,
  type ContentDraftListItem,
  type LibraryTab,
} from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/page-types';
import { formatNumber } from '@/lib/format';
import { readUrlChoice, writeUrlParams } from '@/lib/url-state';
import { useBrandStore } from '@/stores/use-brand-store';
import { LibraryTable } from './_library-table';

/** A read of the brand's drafts: null until it comes back. */
interface LibraryRead {
  brandId: string;
  drafts: ContentDraftListItem[] | null;
  failed: boolean;
}

/**
 * The Content Library (Content Editor, CE-002): everything a person or the
 * Content Agent wrote or changed in Ansvisor, by status. The tab lives in the
 * URL (?tab=in_review), so a link can open "Library › In review".
 */
export default function ContentLibraryPage() {
  const t = useTranslations('contentEditor.library');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const [tab, setTab] = useState<LibraryTab>('all');
  const [read, setRead] = useState<LibraryRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTab(readUrlChoice('tab', LIBRARY_TABS, 'all'));
  }, []);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    getContentDrafts(activeBrandId)
      .then((drafts) => {
        if (!cancelled) setRead({ brandId: activeBrandId, drafts, failed: false });
      })
      .catch((err) => {
        console.error('Failed to load the content library:', err);
        if (!cancelled) setRead({ brandId: activeBrandId, drafts: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, attempt]);

  const changeTab = (next: LibraryTab) => {
    setTab(next);
    writeUrlParams({ tab: next }, { tab: 'all' });
  };

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  // A read for another brand (just switched) counts as still loading.
  const current = read?.brandId === activeBrandId ? read : null;
  const drafts = current?.drafts ?? null;
  const counts = drafts ? libraryTabCounts(drafts) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button className="gap-2" onClick={() => setStarting(true)}>
          <Plus className="h-4 w-4" />
          {t('newContent')}
        </Button>
      </div>
      <NewContentDialog
        open={starting}
        onOpenChange={setStarting}
        brandId={activeBrandId}
        siteType={siteTypeOf(activeBrand ?? {})}
        onSent={() => setAttempt((n) => n + 1)}
      />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as LibraryTab)}>
        <TabsList variant="line" aria-label={t('tabsLabel')}>
          {LIBRARY_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`tabs.${id}`)}
              {counts && <TabCount count={counts[id]} />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="py-0">
        <CardContent className="px-0">
          {current?.failed ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('loadError')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRead(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            </div>
          ) : drafts === null ? (
            <div className="flex items-center justify-center py-12" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <LibraryTable drafts={draftsInTab(drafts, tab)} tab={tab} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}
