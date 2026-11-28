'use server';

import { z } from 'zod';
import { dbClient } from '@/lib/supabase/scoped';
import { parseDataHealth, type DataHealth, type DataHealthArgs } from '@/lib/data-health';

/**
 * Data health on Insights (00567): per AI platform, expected answers,
 * answers received, missing and the last answer, over the page's window,
 * region and topic. A read through the member's session: RLS on the prompts
 * and the rollup decides whose brand this is, as for the other Insights
 * reads, so it takes no subscription check.
 */

const day = z.iso.date();
const args = z.object({
  dayFrom: day.optional(),
  dayTo: day.optional(),
  region: z.string().min(1).max(64).optional(),
  topicId: z.guid().optional(),
});

export async function getDataHealth(
  brandId: string,
  opts: DataHealthArgs = {},
): Promise<DataHealth> {
  const parsed = args.safeParse(opts);
  if (!z.guid().safeParse(brandId).success || !parsed.success) throw new Error('invalid');
  const { dayFrom, dayTo, region, topicId } = parsed.data;
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('brand_data_health', {
    p_brand_id: brandId,
    p_day_from: dayFrom,
    p_day_to: dayTo,
    p_region: region,
    p_topic_id: topicId,
  });
  if (error) throw new Error(error.message);
  return parseDataHealth(data);
}
