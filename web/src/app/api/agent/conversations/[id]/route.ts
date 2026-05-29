import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAgentAuth } from '@/lib/agent/auth';

/**
 * GET /api/agent/conversations/[id]
 *
 * Return one conversation plus its ordered messages so the chat panel can
 * hydrate when the user opens a thread from the sidebar (or refreshes).
 * Ownership-check before the messages select — wrong-org or someone
 * else's conversation returns 404 to avoid id-probing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveAgentAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: conversation } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, title, brand_id, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const { data: messages } = await supabaseAdmin
    .from('agent_messages')
    .select(
      'id, role, content, tool_calls, tool_call_id, tool_name, tool_result, prompt_tokens, completion_tokens, created_at',
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ conversation, messages: messages ?? [] });
}

/**
 * DELETE /api/agent/conversations/[id]
 *
 * Drop a conversation (cascades to its messages). Ownership-check first.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveAgentAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Match on user_id + organization_id so an attacker can't burn someone
  // else's conversation by guessing an id.
  const { error, count } = await supabaseAdmin
    .from('agent_conversations')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .eq('organization_id', auth.organizationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
