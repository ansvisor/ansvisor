'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Network, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import {
  listTopicCategories,
  setTopicCategory,
  type CategoryPageError,
  type TopicCategories as TopicCategoriesData,
  type TopicCategory,
} from '@/lib/catalog-client';
import { useBrandStore } from '@/stores/use-brand-store';

/**
 * Topics and categories (AC plan P-7, 00494): which catalog categories each
 * of the active brand's topics is about, so a topic's work reaches its
 * category page and products. The API works them out from the words of a
 * category's own name in the topic's name or prompts; admins and managers
 * take one away or link another, and members see the list. Shown once the
 * brand has topics and catalog categories. On a read-only workspace a
 * change opens the upgrade dialog instead.
 *
 * `refreshKey`: changed by the page to read them again (the catalog read again).
 */
export function TopicCategories({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations('settings.catalog.topicCategories');
  const { activeBrandId } = useBrandStore();
  const { canManage } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const needsPlan = { action: tActions('changeCategoryPages') };

  // As read for a brand: another brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    data: TopicCategoriesData | null;
  } | null>(null);
  const [reads, setReads] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    void listTopicCategories(activeBrandId).then((result) => {
      if (cancelled) return;
      setLoaded({ brandId: activeBrandId, data: result.ok ? result.value : null });
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, reads, refreshKey]);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  if (!activeBrandId) return null;
  if (current === null) return <Skeleton className="h-24 w-full" />;
  // No topics or no categories yet: nothing to link.
  if (current.data && (!current.data.topics.length || !current.data.categories.length)) {
    return null;
  }

  const change = guard(async (topicId: string, categoryId: string, linked: boolean) => {
    setBusy(true);
    const result: { ok: true } | { ok: false; code: CategoryPageError } = await setTopicCategory(
      activeBrandId,
      topicId,
      categoryId,
      linked,
    );
    setBusy(false);
    if (!result.ok && result.code === 'subscription') {
      openUpgrade(needsPlan.action);
      return;
    }
    if (!result.ok) {
      toast.error(t(`errors.${result.code}`));
      return;
    }
    toast.success(t('saved'));
    setReads((n) => n + 1);
  }, needsPlan);

  const chip = (topicId: string, category: TopicCategory) => (
    <Badge key={category.id} variant="secondary" className="max-w-full gap-1 font-normal">
      <span className="truncate" title={category.name}>
        {category.name}
      </span>
      <span className="text-[10px] text-muted-foreground">{t(`source.${category.source}`)}</span>
      {canManage && (
        <button
          type="button"
          disabled={busy}
          aria-label={t('remove', { category: category.name })}
          className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => void change(topicId, category.id, false)}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );

  return (
    <section aria-labelledby="catalog-topic-categories" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Network className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p id="catalog-topic-categories" className="font-medium">
            {t('title')}
          </p>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>
      {current.data === null ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('topic')}</th>
                <th className="px-3 py-2 font-medium">{t('categories')}</th>
              </tr>
            </thead>
            <tbody>
              {current.data.topics.map((topic) => {
                const linked = new Set(topic.categories.map((c) => c.id));
                const others = current.data!.categories.filter((c) => !linked.has(c.id));
                return (
                  <tr key={topic.id} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{topic.name}</td>
                    <td className="space-y-2 px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {topic.categories.length ? (
                          topic.categories.map((category) => chip(topic.id, category))
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('none')}</span>
                        )}
                      </div>
                      {canManage && others.length > 0 && (
                        <Select
                          value=""
                          disabled={busy}
                          onValueChange={(categoryId) => {
                            if (categoryId) void change(topic.id, categoryId, true);
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-full max-w-xs text-xs"
                            aria-label={t('addLabel', { topic: topic.name })}
                          >
                            <SelectValue placeholder={t('add')} />
                          </SelectTrigger>
                          <SelectContent>
                            {others.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
