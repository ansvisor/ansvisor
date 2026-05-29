import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAgentAuth } from '@/lib/agent/auth';
import { getPlan, hasFeature, type PlanId } from '@/config/plans';
import { isAnthropicKeyConfigured } from '@/lib/agent/key';

/**
 * GET /api/agent/conversations
 *
 * List the calling user's conversations, newest first. Powers the agent
 * page's sidebar.
 */
export async function GET() {
  const auth = await resolveAgentAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, title, brand_id, created_at, updated_at')
    .eq('user_id', auth.userId)
    .eq('organization_id', auth.organizationId)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}

/**
 * POST /api/agent/conversations
 *
 * Create a new conversation row. Optional `brand_id` pins the chat to a
 * brand so the agent's tool calls have an implicit scope. Returns the row.
 *
 * Plan-gated: the chat endpoint already gates on `ai_agent`, but we gate
 * here too so a non-Growth user clicking "+ New chat" gets the 403
 * immediately rather than after typing a message.
 */
export async function POST(req: Request) {
  const auth = await resolveAgentAuth();
  if (!auth || !auth.organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const organizationId: string = auth.organizationId;

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .maybeSingle();
  const plan = getPlan((org?.plan ?? 'starter') as PlanId);
  if (!hasFeature(plan, 'ai_agent')) {
    return NextResponse.json({ error: 'ai_agent is not enabled for this plan' }, { status: 403 });
  }

  // BYOK gate — match the chat endpoint so "+ new chat" can't create a row
  // the user can never send a message to. UI uses the same code to route
  // to the Settings → Agent CTA.
  const hasKey = await isAnthropicKeyConfigured(organizationId);
  if (!hasKey) {
    return NextResponse.json(
      { error: 'Anthropic API key required', code: 'missing_anthropic_key' },
      { status: 403 },
    );
  }

  let body: { brandId?: string; title?: string } = {};
  try {
    body = (await req.json()) as { brandId?: string; title?: string };
  } catch {
    // Empty body is fine — the form may not send one.
  }

  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .insert({
      user_id: auth.userId,
      organization_id: auth.organizationId,
      brand_id: body.brandId ?? null,
      title: body.title ?? 'New conversation',
    })
    .select('id, title, brand_id, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create conversation' },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation: data }, { status: 201 });
}
