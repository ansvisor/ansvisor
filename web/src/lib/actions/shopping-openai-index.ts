'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { OpenAiIndexRead } from '@/lib/shopping/openai-index';
import { getShoppingMerchantSplit, type ShoppingDatePreset } from './shopping';

/**
 * What "Catalog in OpenAI's product index" reads (#1281): the brand's word
 * that it sends a direct feed, and the cards for its own products in US
 * ChatGPT Shopping answers over the Overview's window, counted by
 * `shopping_merchant_split` (own-product cards, classified or not). RLS and
 * the RPC's membership check keep both to the caller's organization.
 */
export async function getOpenAiIndexRead(
  brandId: string,
  datePreset: ShoppingDatePreset,
): Promise<OpenAiIndexRead> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const [brand, split] = await Promise.all([
    supabase.from('brands').select('openai_product_feed').eq('id', brandId).maybeSingle(),
    getShoppingMerchantSplit(brandId, {
      datePreset,
      platforms: ['chatgpt-shopping'],
      chatgptMarket: 'us',
    }),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  if (!brand.data) throw new Error('not_found');
  return {
    directFeed: !!brand.data.openai_product_feed,
    ownCards: split.classifiedCards + split.unclassifiedCards,
  };
}

/**
 * The brand's word that it sends OpenAI a direct product feed (00277).
 * Admins and managers (brands: admin/manager update); a brand they can't
 * change is refused.
 */
export async function setOpenAiProductFeed(brandId: string, on: boolean): Promise<void> {
  if (!z.guid().safeParse(brandId).success || typeof on !== 'boolean') throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ openai_product_feed: on })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}
