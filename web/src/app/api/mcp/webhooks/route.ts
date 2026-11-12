import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { listBrandsFor } from '@/lib/mcp/data';
import { requireManager, RoleRequiredError, roleRequiredResponse } from '@/lib/mcp/role-gate';
import { DEMO_BRAND, isDemoBrandOf } from '@/lib/mcp/demo-gate';
import { supabaseAdmin } from '@/lib/supabase/admin';

const createSubscriptionSchema = z.object({
  brand_id: z.string().uuid(),
  event: z.enum(['daily_pulse.created', 'action_task.sent', 'content_draft.sent']),
  webhook_url: z.string().url(),
  webhook_secret: z.string().min(1).max(512),
  subscription_id: z.string().regex(/^[a-f0-9]{32}$/),
});

export async function POST(request: Request) {
  const auth = await authenticateMcpRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    requireManager(auth);
  } catch (error) {
    if (error instanceof RoleRequiredError) return roleRequiredResponse(error);
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = createSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Provide a valid brand, supported event, HTTPS webhook URL, secret and subscription ID.',
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  let targetUrl: URL;
  try {
    targetUrl = new URL(input.webhook_url);
  } catch {
    return NextResponse.json({ error: 'Webhook URL is invalid.' }, { status: 400 });
  }
  if (targetUrl.protocol !== 'https:' || targetUrl.username || targetUrl.password) {
    return NextResponse.json(
      { error: 'Webhook URL must use HTTPS and must not contain credentials.' },
      { status: 400 },
    );
  }

  try {
    const brands = await listBrandsFor(auth);
    if (!brands.some((brand) => brand.id === input.brand_id)) {
      return NextResponse.json({ error: 'Brand not found or not accessible.' }, { status: 404 });
    }

    if (await isDemoBrandOf(auth.organizationId, input.brand_id)) {
      return NextResponse.json(DEMO_BRAND, { status: 402 });
    }

    const name = 'Zapier:' + input.subscription_id;
    const { data, error } = await supabaseAdmin
      .from('webhook_configs')
      .upsert(
        {
          brand_id: input.brand_id,
          name,
          webhook_url: input.webhook_url,
          webhook_secret: input.webhook_secret,
          events: [input.event],
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id,name' },
      )
      .select('id')
      .single();

    if (error || !data) {
      console.error(
        '[api/mcp/webhooks] subscription upsert failed',
        error?.message || 'No row returned',
      );
      return NextResponse.json(
        { error: 'Unable to register the webhook subscription.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    console.error(
      '[api/mcp/webhooks] subscription registration failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return NextResponse.json(
      { error: 'Unable to register the webhook subscription.' },
      { status: 500 },
    );
  }
}