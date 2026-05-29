import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptApiKey, last4 } from '@/lib/agent/key-encryption';

/**
 * GET / PUT / DELETE /api/settings/anthropic-key
 *
 * Manages the org-level Anthropic API key the in-product agent uses on
 * cloud. We never return the plaintext — GET surfaces only the metadata
 * the Settings UI needs to render the "configured" state (last4, set_at,
 * who saved it).
 *
 * Auth model:
 * - GET: any signed-in org member can see whether a key is configured.
 *   The chat endpoint already gates, so leaking "we have a key" is fine.
 * - PUT / DELETE: admins only. Same role bar as team management — adding
 *   a payment instrument (which is effectively what an Anthropic key is)
 *   shouldn't be a non-admin action.
 */

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

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(
      'anthropic_api_key_last4, anthropic_api_key_set_at, anthropic_api_key_set_by, anthropic_api_key_encrypted',
    )
    .eq('id', ctx.profile.organization_id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch the saver's name separately — the FK we declared is to
  // `profiles(id)`, which the auth user model already mirrors, so a quick
  // second query is simpler than a join through PostgREST.
  let setByEmail: string | null = null;
  if (data?.anthropic_api_key_set_by) {
    const { data: setter } = await supabaseAdmin.auth.admin.getUserById(
      data.anthropic_api_key_set_by,
    );
    setByEmail = setter?.user?.email ?? null;
  }

  return NextResponse.json({
    configured: !!data?.anthropic_api_key_encrypted,
    last4: data?.anthropic_api_key_last4 ?? null,
    setAt: data?.anthropic_api_key_set_at ?? null,
    setByEmail,
  });
}

export async function PUT(req: Request) {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }
  if (ctx.profile.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can manage the Anthropic API key' },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const apiKey = (body.apiKey ?? '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }
  // Anthropic keys are `sk-ant-…`. We do a soft format check rather than a
  // hard one — the prefix has changed before and we don't want to lock
  // users out over a future format bump. A network validation against
  // /v1/messages would be more rigorous but doubles save latency for
  // little gain; the first chat turn will surface a bad key as a 401
  // immediately anyway.
  if (apiKey.length < 20 || apiKey.length > 200) {
    return NextResponse.json({ error: 'apiKey looks malformed' }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encryptApiKey(apiKey);
  } catch (err) {
    // Misconfigured server env — surface a clear 500 instead of writing
    // unrecoverable data.
    console.error('[anthropic-key] encryption failed:', err);
    return NextResponse.json({ error: 'Server encryption is not configured' }, { status: 500 });
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      anthropic_api_key_encrypted: encrypted,
      anthropic_api_key_last4: last4(apiKey),
      anthropic_api_key_set_at: new Date().toISOString(),
      anthropic_api_key_set_by: ctx.profile.id,
    })
    .eq('id', ctx.profile.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }
  if (ctx.profile.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can manage the Anthropic API key' },
      { status: 403 },
    );
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      anthropic_api_key_encrypted: null,
      anthropic_api_key_last4: null,
      anthropic_api_key_set_at: null,
      anthropic_api_key_set_by: null,
    })
    .eq('id', ctx.profile.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
