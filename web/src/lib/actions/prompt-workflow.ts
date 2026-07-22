'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * Prompt workflow (v1): per-prompt work status, a notes thread, and target
 * URLs. All access control lives in RLS (00031): members read, admin/manager
 * write, everything scoped to the caller's org through
 * prompts → prompt_sets → brands.
 */

export type PromptWorkStatus = 'todo' | 'in_progress' | 'done';

export interface PromptNote {
  id: string;
  promptId: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface PromptTargetUrl {
  id: string;
  promptId: string;
  url: string;
  label: string | null;
  createdAt: string;
}

export interface PromptWorkflowData {
  workStatus: PromptWorkStatus | null;
  notes: PromptNote[];
  targetUrls: PromptTargetUrl[];
}

export async function getPromptWorkflow(promptId: string): Promise<PromptWorkflowData> {
  const supabase = await createClient();

  const [promptRes, notesRes, urlsRes] = await Promise.all([
    supabase.from('prompts').select('work_status').eq('id', promptId).maybeSingle(),
    supabase
      .from('prompt_notes')
      .select('id, prompt_id, body, created_at, profiles(full_name)')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: false }),
    supabase
      .from('prompt_target_urls')
      .select('id, prompt_id, url, label, created_at')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: true }),
  ]);

  if (notesRes.error) throw new Error(notesRes.error.message);
  if (urlsRes.error) throw new Error(urlsRes.error.message);

  const notes: PromptNote[] = (notesRes.data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const profile = r.profiles as { full_name: string | null } | null;
    return {
      id: r.id as string,
      promptId: r.prompt_id as string,
      body: r.body as string,
      authorName: profile?.full_name ?? null,
      createdAt: r.created_at as string,
    };
  });

  const targetUrls: PromptTargetUrl[] = (urlsRes.data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    return {
      id: r.id as string,
      promptId: r.prompt_id as string,
      url: r.url as string,
      label: (r.label as string | null) ?? null,
      createdAt: r.created_at as string,
    };
  });

  return {
    workStatus: (promptRes.data?.work_status as PromptWorkStatus | null) ?? null,
    notes,
    targetUrls,
  };
}

export async function setPromptWorkStatus(
  promptId: string,
  status: PromptWorkStatus | null,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('prompts')
    .update({ work_status: status })
    .eq('id', promptId);
  if (error) throw new Error(error.message);
}

export async function addPromptNote(promptId: string, body: string): Promise<PromptNote> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Note cannot be empty');
  if (trimmed.length > 2000) throw new Error('Note is too long (max 2000 characters)');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('prompt_notes')
    .insert({ prompt_id: promptId, body: trimmed, author_id: user?.id ?? null })
    .select('id, prompt_id, body, created_at, profiles(full_name)')
    .single();
  if (error) throw new Error(error.message);

  const r = data as unknown as Record<string, unknown>;
  const profile = r.profiles as { full_name: string | null } | null;
  return {
    id: r.id as string,
    promptId: r.prompt_id as string,
    body: r.body as string,
    authorName: profile?.full_name ?? null,
    createdAt: r.created_at as string,
  };
}

export async function deletePromptNote(noteId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('prompt_notes').delete().eq('id', noteId);
  if (error) throw new Error(error.message);
}

/** Basic sanity check — the value must parse as an http(s) URL. */
function normalizeTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }
  return parsed.toString();
}

export async function addPromptTargetUrl(
  promptId: string,
  url: string,
  label?: string,
): Promise<PromptTargetUrl> {
  let normalized: string;
  try {
    normalized = normalizeTargetUrl(url);
  } catch {
    throw new Error('Enter a valid URL');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('prompt_target_urls')
    .insert({
      prompt_id: promptId,
      url: normalized,
      label: label?.trim() || null,
      added_by: user?.id ?? null,
    })
    .select('id, prompt_id, url, label, created_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('This URL is already targeted for this prompt');
    throw new Error(error.message);
  }

  const r = data as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    promptId: r.prompt_id as string,
    url: r.url as string,
    label: (r.label as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function deletePromptTargetUrl(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('prompt_target_urls').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
