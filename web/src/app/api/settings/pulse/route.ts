import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * GET / PUT /api/settings/pulse
 *
 * Daily Pulse delivery preferences (#540), per brand.
 *
 * Auth model (same bar as the webhook config RLS):
 * - GET: any signed-in org member sees each brand's frequency/recipients.
 * - PUT: admins and managers change them.
 */

const FREQUENCIES = ['daily', 'weekly', 'notable', 'off'] as const;
type Frequency = (typeof FREQUENCIES)[number];

async function getCallerAndOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) return { error: 'No organization' as const };

  return {
    user,
    profile: profile as { id: string; role: string; organization_id: string },
  };
}

export async function GET() {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }

  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('organization_id', ctx.profile.organization_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const brandIds = (brands ?? []).map((b) => b.id);
  const { data: settings } = brandIds.length
    ? await supabaseAdmin
        .from('pulse_settings')
        .select('brand_id, frequency, recipients')
        .in('brand_id', brandIds)
    : { data: [] };

  const settingsByBrand = new Map((settings ?? []).map((s) => [s.brand_id, s]));

  return NextResponse.json({
    brands: (brands ?? []).map((brand) => {
      const s = settingsByBrand.get(brand.id);
      return {
        brandId: brand.id,
        brandName: brand.name,
        frequency: s?.frequency ?? 'daily',
        recipients: s?.recipients ?? [],
      };
    }),
  });
}

export async function PUT(request: Request) {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }
  if (ctx.profile.role !== 'admin' && ctx.profile.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { brandId?: string; frequency?: string; recipients?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { brandId, frequency } = body;
  if (!brandId || !frequency || !FREQUENCIES.includes(frequency as Frequency)) {
    return NextResponse.json(
      { error: 'brandId and a valid frequency are required' },
      { status: 400 },
    );
  }

  const recipients = Array.isArray(body.recipients)
    ? body.recipients
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.trim())
        .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
        .slice(0, 50)
    : [];

  // The brand must belong to the caller's org.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('id', brandId)
    .single();
  if (!brand || brand.organization_id !== ctx.profile.organization_id) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('pulse_settings').upsert(
    {
      brand_id: brandId,
      frequency,
      recipients: recipients.length ? recipients : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
