import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { firstNameOf } from '@/lib/chat/home';
import { importLegacyChats } from '@/lib/chat/legacy-import';
import { chatRunsOnOwnKey } from '@/lib/chat/key';
import { CHAT_MODES, type ChatMode, type PrecedenceContext } from '@/lib/chat/precedence';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';

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
  /** The app sidebar expanded beside Chat, or the rail (the default; CHAT-01 4f). */
  railOpen: boolean;
}

/**
 * The shell's saved choices, or null while the new Chat is off for the
 * person's workspace (the Chat pages then answer as they do today). A
 * choice that can't be read falls back to its default. On the person's
 * first visit their Agent Chat conversations are copied in first (W1-02),
 * so the menu lists them; a copy that fails is tried again next time and
 * never keeps Chat from opening.
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
  const organizationId = profile?.organization_id ?? null;
  if (!chatAgenticEnabled(organizationId)) return null;
  const { data: prefs, error } = await supabase
    .from('chat_user_prefs')
    .select('menu_open, rail_open, legacy_imported_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (organizationId && !error && !prefs?.legacy_imported_at) {
    await importLegacyChats({ userId: user.id, email: user.email ?? null, organizationId });
  }
  return { menuOpen: prefs?.menu_open ?? true, railOpen: prefs?.rail_open ?? false };
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
  /**
   * Full auto runs for this person as the server decides it: the plan (plan
   * facts §7: Growth and up, paid) and, for anyone but an Admin, the Admin's
   * "Full auto for members" switch (CHAT-23).
   */
  fullAutoOpen: boolean;
  /** Closed by the Admin's switch, not the plan: the composer says so instead of "Needs Growth". */
  fullAutoOffByAdmin: boolean;
  /** The AI usage period whose 80% line the person already saw (CHAT-04 item 16). */
  usageNoticeSeen: string | null;
  /**
   * Chat runs on the workspace's own key (chatRunsOnOwnKey): its steps don't
   * draw on the AI budget, so a used-up allowance doesn't pause it.
   */
  onOwnKey: boolean;
}

/** The modes part of the setup, from the person's saved mode and the precedence facts. */
type ComposerModeSetup = Pick<
  ChatComposerSetup,
  'defaultMode' | 'fullAutoOpen' | 'fullAutoOffByAdmin'
>;

const CAREFUL_MODES: ComposerModeSetup = {
  defaultMode: 'auto',
  fullAutoOpen: false,
  fullAutoOffByAdmin: false,
};

const CAREFUL_SETUP: ChatComposerSetup = {
  ...CAREFUL_MODES,
  usageNoticeSeen: null,
  onOwnKey: false,
};

/**
 * The setup from the person's saved default mode and the facts the approval
 * precedence decides a run by (role, plan, Chat settings), so the composer
 * never offers a Full auto the server would turn into a card. A saved Full
 * auto that isn't open any more starts as Auto, ask before changes. No
 * facts, the careful setup.
 */
export function composerSetupOf(
  savedMode: unknown,
  ctx: Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
): ComposerModeSetup {
  if (!ctx) return CAREFUL_MODES;
  const forRole = ctx.role === 'admin' || ctx.settings.fullAutoForMembers;
  const fullAutoOpen = ctx.plan.fullAuto && forRole;
  const defaultMode = CHAT_MODES.find((m) => m === savedMode) ?? 'auto';
  return {
    defaultMode: defaultMode === 'full_auto' && !fullAutoOpen ? 'auto' : defaultMode,
    fullAutoOpen,
    fullAutoOffByAdmin: ctx.plan.fullAuto && !forRole,
  };
}

/**
 * The composer's setup: the default mode the person chose in Chat's settings
 * (chat_user_prefs.default_mode; Auto, ask before changes, when none), and
 * Full auto as the server will decide it, the period whose 80% usage line
 * the person already saw, and whether Chat runs on the workspace's own key.
 * A value that can't be read falls back to the careful one.
 */
export async function chatComposerSetup(): Promise<ChatComposerSetup> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return CAREFUL_SETUP;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) return CAREFUL_SETUP;
  const [{ data: prefs }, ctx, onOwnKey] = await Promise.all([
    supabase
      .from('chat_user_prefs')
      .select('default_mode, usage_notice_period')
      .eq('user_id', user.id)
      .maybeSingle(),
    readPrecedenceContext({
      userId: user.id,
      organizationId: profile.organization_id,
      mode: 'ask_first',
      surface: 'chat',
    }).catch(() => null),
    chatRunsOnOwnKey(profile.organization_id).catch(() => false),
  ]);
  return {
    ...composerSetupOf(prefs?.default_mode, ctx),
    usageNoticeSeen: prefs?.usage_notice_period ?? null,
    onOwnKey,
  };
}
