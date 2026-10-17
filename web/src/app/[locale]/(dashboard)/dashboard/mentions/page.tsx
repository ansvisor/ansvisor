'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTopics } from '@/lib/actions/topic';
import { getBrandFilterOptions } from '@/lib/actions/tracking';
import {
  DEFAULT_MENTIONS_FILTERS,
  DEFAULT_MENTIONS_TAB,
  MENTIONS_TABS,
  mentionsStateParams,
  readMentionsState,
  type MentionsFilters,
  type MentionsTab,
} from '@/lib/mentions-filters';
import { writeUrlParams } from '@/lib/url-state';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Topic } from '@/types';
import { MentionsFilterBar } from './_filter-bar';

/**
 * Mentions & Sentiment (MS-05): where AI mentions the brand, how it describes
 * it, and what to do about it — built from the answers tracking already
 * stores, so opening the page or changing a filter never calls an LLM.
 *
 * Top-down as the spec orders it: the tabs, then the filters every tab
 * shares, then the tab's content. Tab and filters live in the URL.
 */
export default function MentionsPage() {
  const t = useTranslations('mentions');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  const [tab, setTab] = useState<MentionsTab>(DEFAULT_MENTIONS_TAB);
  const [filters, setFilters] = useState<MentionsFilters>(DEFAULT_MENTIONS_FILTERS);
  // Read after mount (window isn't available during the server render), as
  // Citations does; the URL is written only once it has been read.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const state = readMentionsState(new URLSearchParams(window.location.search));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTab(state.tab);
    setFilters(state.filters);
    setUrlRead(true);
  }, []);
  useEffect(() => {
    if (urlRead) writeUrlParams(mentionsStateParams(tab, filters));
  }, [urlRead, tab, filters]);

  const [regions, setRegions] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    getBrandFilterOptions(activeBrandId)
      .then((options) => {
        if (!cancelled) setRegions([...options.regions].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    getTopics(activeBrandId)
      .then((rows) => {
        if (!cancelled) setTopics(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as MentionsTab)}>
        <TabsList aria-label={t('tabs.label')}>
          {MENTIONS_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4">
          <MentionsFilterBar
            filters={filters}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            regions={regions}
            topics={topics}
          />
        </div>

        {MENTIONS_TABS.map((id) => (
          <TabsContent key={id} value={id} className="mt-4">
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t('comingSoon')}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
