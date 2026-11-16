import { NextResponse } from 'next/server';
import { adsEnabled } from '@/lib/ads/flag';
import { NO_CONNECTION_ROWS, readConnectionRows } from '@/lib/chat/connection-rows';
import { connectionRecords, readSignIns } from '@/lib/chat/connections';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/user-brand-state';

const refuse = (status: number, code: string) =>
  NextResponse.json({ error: code, code }, { status });

/**
 * GET /api/ads/connections?brandId=… — Google Analytics on Ads' Connections
 * tab (ADS-01 §3.5): its status as Chat's Connections has it, built from the
 * one read of a brand's connections (lib/chat/connection-rows.ts) and the
 * workspace's sign-ins, so connected anywhere is connected here. Not found
 * while Ads is off (404 off) or for a brand the person doesn't reach, read
 * through their own client first (RLS); the service-role reads are then
 * that brand's and its workspace's alone.
 */
export async function GET(req: Request) {
  if (!adsEnabled()) return refuse(404, 'off');
  const brandId = new URL(req.url).searchParams.get('brandId');
  if (!isUuid(brandId)) return refuse(400, 'invalid');
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return refuse(401, 'unauthorized');
    const { data: brand, error } = await supabase
      .from('brands')
      .select('id, organization_id')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand) return refuse(404, 'not_found');
    const [rows, signIns] = await Promise.all([
      readConnectionRows([brand.id]),
      readSignIns(brand.organization_id),
    ]);
    const analytics = connectionRecords({
      rows: rows.get(brand.id) ?? NO_CONNECTION_ROWS,
      signIns,
    }).find((record) => record.key === 'google_analytics');
    return NextResponse.json({ analytics: { status: analytics?.status ?? 'not_connected' } });
  } catch (error) {
    console.error('[ads/connections] could not read Google Analytics:', error);
    return refuse(500, 'failed');
  }
}
