import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { firstNameOf } from '@/lib/chat/home';
import { planFactsFromOrgRow } from '@/lib/chat/plan-facts';
import { CHAT_MODES, type ChatMode } from '@/lib/chat/precedence';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/plan-row';

/** Whether the signed-in person's workspace has the new Chat on (CHAT_AGENTIC). */
export async function chatPageOpen(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return chatAgenticEnabled(profile?.organization_id ?? null);
}

/** What the Chat shell opens with: the person's saved choices (chat_user_prefs). */
export interface ChatShellPrefs {
  /** The chat menu shown (the default) or hidden (CHAT-01 item 9d). */
  menuOpen: boolean;
}

/**
 * The shell's saved choices, or null while the new Chat is off for the
 * person's workspace (the Chat pages then answer as they do today). A
 * choice that can't be read falls back to its default.
 */
export async function chatShellPrefs(): Promise<ChatShellPrefs | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!chatAgenticEnabled(profile?.organization_id ?? null)) return null;
  const { data: prefs } = await supabase
    .from('chat_user_prefs')
    .select('menu_open')
    .eq('user_id', user.id)
    .maybeSingle();
  return { menuOpen: prefs?.menu_open ?? true };
}

/**
 * The first name Chat Home greets the person with (CHAT-01 item 10): their
 * profile's name, else their sign-in's; null without one.
 */
export async function chatFirstName(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const metadataName = (user.user_metadata as { full_name?: unknown } | null)?.full_name;
  return firstNameOf(
    profile?.full_name ?? (typeof metadataName === 'string' ? metadataName : null),
  );
}

/** What the composer opens with (W1-10): the person's default mode, and whether Full auto is open. */
export interface ChatComposerSetup {
  defaultMode: ChatMode;
  /** Full auto (plan facts §7): Growth and up, paid. */
  fullAutoOpen: boolean;
  /** The AI usage period whose 80% line the person already saw (CHAT-04 item 16). */
  usageNoticeSeen: string | null;
}

/**
 * The composer's setup: the default mode the person chose in Chat's settings
 * (chat_user_prefs.default_mode; Auto, ask before changes, when none), and
 * Full auto from the workspace's plan. A value that can't be read falls back
 * to the careful one.
 */
export async function chatComposerSetup(): Promise<ChatComposerSetup> {
  const fallback: ChatComposerSetup = {
    defaultMode: 'auto',
    fullAutoOpen: false,
    usageNoticeSeen: null,
  };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fallback;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) return fallback;
  const [{ data: prefs }, { data: org }] = await Promise.all([
    supabase
      .from('chat_user_prefs')
      .select('default_mode, usage_notice_period')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', profile.organization_id)
      .maybeSingle(),
  ]);
  const saved = prefs?.default_mode;
  const fullAutoOpen = org ? planFactsFromOrgRow(org).fullAuto : false;
  const defaultMode = CHAT_MODES.find((m) => m === saved) ?? 'auto';
  // A saved Full auto the plan no longer opens starts as Auto, ask before changes.
  return {
    defaultMode: defaultMode === 'full_auto' && !fullAutoOpen ? 'auto' : defaultMode,
    fullAutoOpen,
    usageNoticeSeen: prefs?.usage_notice_period ?? null,
  };
}
