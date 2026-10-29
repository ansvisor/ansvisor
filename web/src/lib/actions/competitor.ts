'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Competitor } from '@/types';
import { assertWritable } from '@/lib/subscription-guard';
import { z } from 'zod';
import { readAllRpcRows } from '@/lib/supabase/rpc-pages';
import {
  parseTimelineEvents,
  timelineSince,
  weeklyMentions,
  type CompetitorTimeline,
} from '@/lib/competitor-timeline';

/** A competitor's page events the timeline reads at most. */
const TIMELINE_EVENTS = 50;

function mapRow(row: Record<string, unknown>): Competitor {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    domain: (row.domain as string) ?? '',
  };
}

export async function getCompetitors(brandId: string): Promise<Competitor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function addCompetitor(
  brandId: string,
  input: { name: string; domain: string },
): Promise<Competitor> {
  await assertWritable({ onboarding: true, brandId });
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .insert({
      brand_id: brandId,
      name: input.name.trim(),
      domain: input.domain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, ''),
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to add competitor');

  revalidatePath('/dashboard/brands');
  return mapRow(data as Record<string, unknown>);
}

export async function deleteCompetitor(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const { error } = await supabase.from('competitors').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/brands');
}

/**
 * A competitor's pages over time (learning C3) for the Competitors page: the
 * brand's and the competitor's mentioning answers per week over the chart's
 * weeks (the daily rollups, every row read), and the competitor's page
 * events, newest first. RLS keeps both to the caller's organization.
 */
export async function getCompetitorTimeline(
  brandId: string,
  competitorId: string,
): Promise<CompetitorTimeline> {
  if (!z.guid().safeParse(brandId).success || !z.guid().safeParse(competitorId).success) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const now = new Date();
  const since = timelineSince(now);
  type DayRow = { day: string; mention_answers: number | null };
  const daily = (table: 'insights_brand_daily' | 'insights_competitor_daily') =>
    readAllRpcRows<DayRow>((from, to) => {
      let query = supabase
        .from(table)
        .select('day, mention_answers')
        .eq('brand_id', brandId)
        .gte('day', since);
      if (table === 'insights_competitor_daily') query = query.eq('competitor_id', competitorId);
      return query
        .order('day')
        .order('platform')
        .order('model_used')
        .order('region')
        .range(from, to) as unknown as PromiseLike<{
        data: DayRow[] | null;
        error: { message: string } | null;
      }>;
    });
  const [brandRows, competitorRows, events] = await Promise.all([
    daily('insights_brand_daily'),
    daily('insights_competitor_daily'),
    supabase
      .from('competitor_page_events')
      .select('kind, at, url, domain, detail')
      .eq('brand_id', brandId)
      .eq('competitor_id', competitorId)
      .order('at', { ascending: false })
      .limit(TIMELINE_EVENTS),
  ]);
  if (events.error) throw new Error(events.error.message);
  return {
    weeks: weeklyMentions(brandRows, competitorRows, now),
    events: parseTimelineEvents(events.data ?? []),
  };
}
