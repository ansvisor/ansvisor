'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import type {
  MarketplaceAdd,
  MarketplaceCard as Card,
  MarketplacePage,
} from '@/lib/chat/skills/marketplace-store';
import {
  MARKETPLACE_TOPICS,
  formatSkillCount,
  type MarketplaceSort,
  type MarketplaceTopic,
} from '@/lib/chat/skills/marketplace-view';
import type { ImportedSkill } from '@/lib/chat/skills/store';
import { cn } from '@/lib/utils';

/**
 * The Library tab (CHAT-17 items 1–7 and 11–13; Chat Wave 4 W4-18, W4-19;
 * mockup `#s-skills`, tab "Library"): third-party MIT skills to add. Topic
 * chips with the catalog's counts, "Search skills…", "N skills · MIT
 * license" and the sort (Most stars, Most installs); 30 cards, then "Show
 * more (N)". A card: its name, its line, the repo's GitHub stars, its
 * installs on skills.sh, "owner · MIT" and Add; no likes or votes (item
 * 7). Clicking it opens its detail (library-skill.tsx). Add (an Admin or
 * a Manager) turns it on for them at once, private, and the card says
 * "Added" (owner, 2026-11-09). The cards come from
 * the API: the catalog never reaches the browser. The topic, the sort and
 * the search stay in the address, so Back returns to them.
 */

type Topic = 'all' | MarketplaceTopic;
type T = ReturnType<typeof useTranslations<'chatSkills.library'>>;

const CARD =
  'flex min-w-0 cursor-pointer flex-col gap-2 rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)] hover:border-foreground/25';
const BADGE = 'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium';
const STATE_TONE: Record<NonNullable<Card['added']>['status'], string> = {
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  rejected: 'bg-muted text-muted-foreground',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
};

/** A Library skill's detail page. */
export const librarySkillHref = (id: string) =>
  `/dashboard/chat/skills/library?skill=${encodeURIComponent(id)}`;

/** The topic, the sort and the search the address holds. */
function stateOf(search: string): { topic: Topic; sort: MarketplaceSort; query: string } {
  const params = new URLSearchParams(search);
  const topic = params.get('topic') ?? '';
  return {
    topic: (MARKETPLACE_TOPICS as readonly string[]).includes(topic)
      ? (topic as MarketplaceTopic)
      : 'all',
    sort: params.get('sort') === 'installs' ? 'installs' : 'stars',
    query: (params.get('q') ?? '').slice(0, 200),
  };
}

/** The page's address with the tab, the topic, the sort and the search, so Back returns to them. */
function keepInAddress(topic: Topic, sort: MarketplaceSort, query: string) {
  const params = new URLSearchParams({ tab: 'library' });
  if (topic !== 'all') params.set('topic', topic);
  if (sort !== 'stars') params.set('sort', sort);
  if (query.trim()) params.set('q', query.trim());
  window.history.replaceState(window.history.state, '', `?${params.toString()}`);
}

/** Adds a Library skill: the import, or the API's words when it refused. */
export async function addLibrarySkill(
  id: string,
): Promise<
  { ok: true; skill: ImportedSkill } | { ok: false; error: string | null; upgrade: boolean }
> {
  const res = await fetch('/api/chat/skills/marketplace/skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    skill?: ImportedSkill;
    code?: string;
    error?: string;
  } | null;
  if (res?.ok && body?.ok && body.skill) return { ok: true, skill: body.skill };
  // A read-only workspace, or the trial: the plans.
  const upgrade = res?.status === 402 || body?.code === 'library_plan';
  return { ok: false, error: body?.error ?? null, upgrade };
}

export function MarketplaceTab() {
  const t = useTranslations('chatSkills.library');
  const router = useRouter();
  const { openUpgrade } = useUpgradeGate();
  // What the address holds (Back from a skill's detail). The tab shows only
  // after the Skills list is read, in the browser, so the address is there.
  const [kept] = useState(() =>
    stateOf(typeof window === 'undefined' ? '' : window.location.search),
  );
  const [topic, setTopic] = useState<Topic>(kept.topic);
  const [sort, setSort] = useState<MarketplaceSort>(kept.sort);
  const [query, setQuery] = useState(kept.query);
  // The search the list was read for: a moment after typing stops.
  const [searched, setSearched] = useState(kept.query);
  const [version, setVersion] = useState(0);
  // The cards read, with the list they were read for: another list's never show.
  const [read, setRead] = useState<{ key: string; page: MarketplacePage | 'failed' } | null>(null);
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const key = `${topic}|${sort}|${searched}|${version}`;
  const shown = useRef(key);
  const page = read && read.key === key ? read.page : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Each change reads the first 30 again; only the newest read lands.
  useEffect(() => {
    keepInAddress(topic, sort, searched);
    shown.current = key;
    let current = true;
    void readPage({ topic, sort, query: searched, offset: 0 }).then((got) => {
      if (current) setRead({ key, page: got ?? 'failed' });
    });
    return () => {
      current = false;
    };
  }, [key, topic, sort, searched]);

  const showMore = useCallback(async () => {
    if (!page || page === 'failed' || page.next === null || more) return;
    const asked = key;
    setMore(true);
    const got = await readPage({ topic, sort, query: searched, offset: page.next });
    setMore(false);
    // Another topic, sort or search meanwhile: its own cards show.
    if (asked !== shown.current) return;
    if (!got) {
      toast.error(t('loadFailed'));
      return;
    }
    setRead({ key: asked, page: { ...got, skills: [...page.skills, ...got.skills] } });
  }, [page, more, key, topic, sort, searched, t]);

  async function add(card: Card) {
    if (adding || !page || page === 'failed') return;
    setAdding(card.id);
    const added = await addLibrarySkill(card.id);
    setAdding(null);
    if (!added.ok) {
      if (added.upgrade) openUpgrade();
      else toast.error(added.error ?? t('addFailed'));
      return;
    }
    const { skill } = added;
    toast.success(
      skill.status === 'approved'
        ? t('addedOn', { name: skill.name })
        : skill.requested
          ? t('requested')
          : t('added'),
    );
    setRead((now) =>
      now && now.page !== 'failed'
        ? {
            ...now,
            page: {
              ...now.page,
              skills: now.page.skills.map((s) =>
                s.id === card.id ? { ...s, added: { status: skill.status, skillId: skill.id } } : s,
              ),
            },
          }
        : now,
    );
    // A skill still waiting: an Admin reviews it now (CHAT-13 item 17). A Library skill is on
    // at once for whoever added it (owner, 2026-11-09): the card says Added.
    if (skill.status !== 'approved' && page.can.add === 'add') {
      router.push(`/dashboard/chat/skills/${skill.id}`);
    }
  }

  const counts = page && page !== 'failed' ? page.counts : null;
  return (
    <div data-slot="skills-library">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[260px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            maxLength={200}
            data-action="skills.library.search"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <div role="group" aria-label={t('topicsLabel')} className="flex flex-wrap gap-1.5">
          {(['all', ...MARKETPLACE_TOPICS] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={topic === key}
              data-action="skills.library.topic"
              data-topic={key}
              onClick={() => setTopic(key)}
              className={cn(
                // The label and its count centred in the pill, the gap between them.
                'inline-flex h-8 items-center justify-center gap-1 rounded-full border px-3 text-xs leading-none font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                topic === key
                  ? 'border-foreground bg-foreground text-background'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {/* The space reads "SEO 94"; in the flex row the gap spaces them. */}
              {t(`topics.${key}`)}{' '}
              {counts && <span className="tabular-nums opacity-70">{counts[key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span data-slot="library-meta" className="tabular-nums">
          {page && page !== 'failed' ? t('meta', { count: page.total }) : ' '}
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          <span className="sr-only">{t('sortLabel')}</span>
          <select
            value={sort}
            data-action="skills.library.sort"
            onChange={(e) => setSort(e.target.value === 'installs' ? 'installs' : 'stars')}
            className="h-8 rounded-[8px] border bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="stars">{t('sort.stars')}</option>
            <option value="installs">{t('sort.installs')}</option>
          </select>
        </label>
      </div>

      {page === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-[14px]" />
          ))}
        </div>
      ) : page === 'failed' ? (
        <div className="rounded-[14px] border bg-card p-6 text-center text-sm">
          <p className="text-muted-foreground">{t('loadFailed')}</p>
          <Button
            variant="outline"
            className="mt-3"
            data-action="skills.library.retry"
            onClick={() => setVersion((v) => v + 1)}
          >
            {t('retry')}
          </Button>
        </div>
      ) : page.skills.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {page.skills.map((card) => (
              <LibraryCard
                key={card.id}
                card={card}
                can={page.can.add}
                adding={adding === card.id}
                onAdd={() => void add(card)}
                onOpen={() => router.push(librarySkillHref(card.id))}
              />
            ))}
          </div>
          {page.next !== null && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                data-action="skills.library.showMore"
                disabled={more}
                onClick={() => void showMore()}
              >
                {t('showMore', { count: page.total - page.skills.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One page of cards, or null when it couldn't be read. */
async function readPage({
  topic,
  sort,
  query,
  offset,
}: {
  topic: Topic;
  sort: MarketplaceSort;
  query: string;
  offset: number;
}): Promise<MarketplacePage | null> {
  const params = new URLSearchParams({ sort, offset: String(offset) });
  if (topic !== 'all') params.set('topic', topic);
  if (query) params.set('q', query);
  const res = await fetch(`/api/chat/skills/marketplace?${params.toString()}`, {
    cache: 'no-store',
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as ({ ok: true } & MarketplacePage) | null;
  return res?.ok && body?.ok ? body : null;
}

/** "★ 19K" and "⬇ 6.9K" (or "—"), each saying what it counts (items 5–6). */
export function SkillCounts({ card, t }: { card: Card; t: T }) {
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted-foreground tabular-nums">
      <span title={t('stars', { repo: card.repo })} data-slot="library-stars">
        <span aria-hidden>★ </span>
        <span className="sr-only">{t('stars', { repo: card.repo })}: </span>
        {formatSkillCount(card.stars)}
      </span>
      <span
        title={card.installs === null ? t('noInstalls') : t('installs')}
        data-slot="library-installs"
      >
        <span aria-hidden>⬇ </span>
        <span className="sr-only">
          {card.installs === null ? t('noInstalls') : `${t('installs')}: `}
        </span>
        {card.installs === null ? <span aria-hidden>—</span> : formatSkillCount(card.installs)}
      </span>
    </div>
  );
}

/** A card's Add, or what became of its Add: Pending approval, Added (item 13). */
export function AddOrState({
  card,
  can,
  adding,
  onAdd,
  t,
}: {
  card: Card;
  can: MarketplaceAdd;
  adding: boolean;
  onAdd: () => void;
  t: T;
}) {
  if (card.added) {
    const badge = (
      <span
        data-slot="library-state"
        data-state={card.added.status}
        className={cn(BADGE, STATE_TONE[card.added.status])}
      >
        {t(`state.${card.added.status}`)}
      </span>
    );
    // Its review, for an Admin or whoever added it.
    return card.added.skillId && card.added.status !== 'approved' ? (
      <Link
        href={`/dashboard/chat/skills/${card.added.skillId}`}
        data-action="skills.library.review"
        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {badge}
      </Link>
    ) : (
      badge
    );
  }
  if (!can) return null;
  return (
    <Button size="sm" data-action="skills.library.add" disabled={adding} onClick={onAdd}>
      {adding ? t('adding') : t('add')}
    </Button>
  );
}

function LibraryCard({
  card,
  can,
  adding,
  onAdd,
  onOpen,
}: {
  card: Card;
  can: MarketplaceAdd;
  adding: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations('chatSkills.library');
  const owner = card.repo.split('/')[0] ?? card.repo;
  return (
    <div
      className={CARD}
      data-slot="library-card"
      data-skill={card.id}
      // The card opens its detail; its own links and buttons do what they say.
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('a, button')) onOpen();
      }}
    >
      <Link
        href={librarySkillHref(card.id)}
        data-action="skills.library.open"
        title={card.name}
        className="truncate text-[14px] font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {card.name}
      </Link>
      <p title={card.description} className="line-clamp-2 text-[13px] text-muted-foreground">
        {card.description}
      </p>
      <SkillCounts card={card} t={t} />
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span title={card.repo} className="min-w-0 truncate text-[11.5px] text-muted-foreground">
          {t('owner', { owner })}
        </span>
        <span className="ml-auto">
          <AddOrState card={card} can={can} adding={adding} onAdd={onAdd} t={t} />
        </span>
      </div>
    </div>
  );
}
