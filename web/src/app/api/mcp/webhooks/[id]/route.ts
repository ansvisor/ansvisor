import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { listBrandsFor } from '@/lib/mcp/data';
import {
  requireManager,
  RoleRequiredError,
  roleRequiredResponse,
} from '@/lib/mcp/role-gate';
import { DEMO_BRAND, isDemoBrandOf } from '@/lib/mcp/demo-gate';
import { supabaseAdmin } from '@/lib/supabase/admin';

const idSchema = z.string().uuid();

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMcpRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    requireManager(auth);
  } catch (error) {
    if (error instanceof RoleRequiredError) return roleRequiredResponse(error);
    throw error;
  }

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Webhook subscription ID is invalid.' }, { status: 400 });
  }

  try {
    const { data: config, error: lookupError } = await supabaseAdmin
      .from('webhook_configs')
      .select('id, brand_id, name')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[api/mcp/webhooks] subscription lookup failed', lookupError.message);
      return NextResponse.json({ error: 'Unable to remove the webhook subscription.' }, { status: 500 });
    }

    if (!config || !config.name.startsWith('Zapier:')) {
      return NextResponse.json({ error: 'Webhook subscription not found.' }, { status: 404 });
    }

    const brands = await listBrandsFor(auth);
    if (!brands.some((brand) => brand.id === config.brand_id)) {
      return NextResponse.json({ error: 'Webhook subscription not found.' }, { status: 404 });
    }

    if (await isDemoBrandOf(auth.organizationId, config.brand_id)) {
      return NextResponse.json(DEMO_BRAND, { status: 402 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('webhook_configs')
      .delete()
      .eq('id', id)
      .eq('name', config.name);

    if (deleteError) {
      console.error('[api/mcp/webhooks] subscription delete failed', deleteError.message);
      return NextResponse.json({ error: 'Unable to remove the webhook subscription.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/mcp/webhooks] subscription removal failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Unable to remove the webhook subscription.' }, { status: 500 });
  }
}
