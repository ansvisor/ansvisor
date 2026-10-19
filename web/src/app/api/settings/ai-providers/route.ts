import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptApiKey, last4 } from '@/lib/agent/key-encryption';
import { isAiProvider, parseProviderSettings, type AiProvider } from '@/lib/agent/providers';

/**
 * GET / PUT / PATCH / DELETE /api/settings/ai-providers
 *
 * Manages the org-level AI provider keys the in-product agent uses on
 * cloud — one per provider, and the one Chat uses (`active`). We never
 * return the plaintext — GET surfaces only the metadata the Settings UI
 * needs to render each provider (last4, set_at, who saved it, its settings).
 *
 * - GET: the saved providers, and whether Chat has one to use.
 * - PUT { provider, apiKey, settings }: saves (or replaces) a provider's key;
 *   the first one saved becomes the one Chat uses.
 * - PATCH { provider }: makes a saved provider the one Chat uses.
 * - DELETE ?provider=: removes a key; when it was Chat's, the most recently
 *   saved other one takes over.
 *
 * Auth model:
 * - GET: any signed-in org member can see which keys are configured.
 *   The chat endpoint already gates, so leaking "we have a key" is fine.
 * - PUT / PATCH / DELETE: admins only. Same role bar as team management —
 *   adding a payment instrument (which is effectively what a provider key
 *   is) shouldn't be a non-admin action.
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

type Caller = Exclude<Awaited<ReturnType<typeof getCallerAndOrg>>, { error: string }>;

/** The caller when they may change the keys, or the response that says why not. */
async function getAdmin(): Promise<Caller | NextResponse> {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }
  if (ctx.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can manage AI provider keys' }, { status: 403 });
  }
  return ctx;
}

async function setActive(organizationId: string, provider: AiProvider) {
  return supabaseAdmin.rpc('set_active_ai_provider', {
    p_organization_id: organizationId,
    p_provider: provider,
  });
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
    .from('organization_ai_keys')
    .select('provider, key_last4, settings, active, set_at, set_by')
    .eq('organization_id', ctx.profile.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Savers' e-mails, one lookup each — the FK is to `profiles(id)`, which
  // the auth user model mirrors.
  const setters = [...new Set((data ?? []).map((row) => row.set_by).filter(Boolean))];
  const emails = new Map(
    await Promise.all(
      setters.map(async (id) => {
        const { data: setter } = await supabaseAdmin.auth.admin.getUserById(id);
        return [id, setter?.user?.email ?? null] as const;
      }),
    ),
  );

  const rows = (data ?? []).filter((row) => isAiProvider(row.provider));
  return NextResponse.json({
    // Whether Chat has a key to use — what the sidebar badge and Chat ask.
    configured: rows.some((row) => row.active),
    providers: rows.map((row) => ({
      provider: row.provider,
      last4: row.key_last4,
      settings: row.settings ?? {},
      active: row.active,
      setAt: row.set_at,
      setByEmail: row.set_by ? (emails.get(row.set_by) ?? null) : null,
    })),
  });
}

export async function PUT(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    provider?: unknown;
    apiKey?: unknown;
    settings?: unknown;
  };
  if (!isAiProvider(body.provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const provider = body.provider;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }
  // A soft length check rather than each provider's prefix — prefixes have
  // changed before, and the first chat turn surfaces a bad key as a 401
  // immediately anyway.
  if (apiKey.length < 20 || apiKey.length > 300) {
    return NextResponse.json({ error: 'apiKey looks malformed' }, { status: 400 });
  }
  const parsed = parseProviderSettings(provider, body.settings);
  if ('error' in parsed) {
    return NextResponse.json(
      { error: `${parsed.error} is missing or malformed`, field: parsed.error },
      { status: 400 },
    );
  }

  let encrypted: string;
  try {
    encrypted = encryptApiKey(apiKey);
  } catch (err) {
    // Misconfigured server env — surface a clear 500 instead of writing
    // unrecoverable data.
    console.error('[ai-providers] encryption failed:', err);
    return NextResponse.json({ error: 'Server encryption is not configured' }, { status: 500 });
  }

  const organizationId = ctx.profile.organization_id;
  // `active` is left out: a replaced key keeps whether Chat uses it.
  const { error } = await supabaseAdmin.from('organization_ai_keys').upsert(
    {
      organization_id: organizationId,
      provider,
      key_encrypted: encrypted,
      key_last4: last4(apiKey),
      settings: parsed.settings,
      set_at: new Date().toISOString(),
      set_by: ctx.profile.id,
    },
    { onConflict: 'organization_id,provider' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The first key saved is the one Chat uses.
  const { data: active } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  if (!active) {
    const { error: activeError } = await setActive(organizationId, provider);
    if (activeError) {
      return NextResponse.json({ error: activeError.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as { provider?: unknown };
  if (!isAiProvider(body.provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const { data, error } = await setActive(ctx.profile.organization_id, body.provider);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No key is saved for this provider' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const provider = new URL(req.url).searchParams.get('provider');
  if (!isAiProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const organizationId = ctx.profile.organization_id;
  const { data: removed, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .delete()
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .select('active');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Chat's key went: the most recently saved other one takes over.
  if (removed?.some((row) => row.active)) {
    const { data: next } = await supabaseAdmin
      .from('organization_ai_keys')
      .select('provider')
      .eq('organization_id', organizationId)
      .order('set_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next && isAiProvider(next.provider)) {
      const { error: activeError } = await setActive(organizationId, next.provider);
      if (activeError) {
        return NextResponse.json({ error: activeError.message }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
