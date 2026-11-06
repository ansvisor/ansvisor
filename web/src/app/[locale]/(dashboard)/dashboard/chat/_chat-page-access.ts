import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { focusOf, homeViewOf, type FocusArea, type HomeView } from '@/lib/chat/focus';
import { skillsByFocus } from '@/lib/chat/focus-home';
import { firstNameOf } from '@/lib/chat/home';
import { importLegacyChats } from '@/lib/chat/legacy-import';
import { chatRunsOnOwnKey } from '@/lib/chat/key';
import { failingKeyFor } from '@/lib/chat/key-health';
import { CAREFUL_SETUP, composerSetupOf, type ChatComposerSetup } from '@/lib/chat/composer-setup';
import { pageOpenOf } from '@/lib/chat/page-open';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';
import { skillMenuFor } from '@/lib/chat/skills/store';
import { isChatStaff } from '@/lib/chat/staff';
import { readChatStartAudience, type ChatStartAudience } from '@/lib/chat/start-audience';

export { composerSetupOf, type ChatComposerSetup };

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
  /** Ansvisor staff (STAFF_EMAILS): the chat's ⋯ menu offers Debug (CHAT-03 item 25). */
  staff: boolean;
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
  return {
    menuOpen: prefs?.menu_open ?? true,
    railOpen: prefs?.rail_open ?? false,
    staff: isChatStaff(user),
  };
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

/**
 * Chat Home's welcome card (owner decision 2026-11-06; 00486): who it greets,
 * the free trial or the demo (ChatStartAudience), until the person says Not
 * now or ends the product tour; null for everyone else, and when a read fails.
 */
export async function chatWelcome(): Promise<ChatStartAudience | null> {
  try {
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
    if (!profile?.organization_id) return null;
    const [audience, prefs] = await Promise.all([
      readChatStartAudience(supabase, profile.organization_id),
      supabase
        .from('chat_user_prefs')
        .select('welcome_dismissed_at, tour_finished_at')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (prefs.error || prefs.data?.welcome_dismissed_at || prefs.data?.tour_finished_at) {
      return null;
    }
    return audience;
  } catch (error) {
    console.error('[chat] could not read the welcome card:', error);
    return null;
  }
}

/** What Chat focuses on for the person (CHAT-24 §3), as Home and Settings › General open. */
export interface ChatFocusState {
  /** The picked areas, in order; empty when skipped or cleared; null when never asked. */
  focus: FocusArea[] | null;
  /** Home's view (00485): the Default view, or the one the focus tailors. */
  view: HomeView;
  /**
   * The picker opens by itself: never answered and never shown (it shows
   * once). Never for the free trial and the demo (owner decision 2026-11-06):
   * they land on the Default view with the welcome card, and pick a focus
   * later from the pill.
   */
  ask: boolean;
}

const NO_FOCUS: ChatFocusState = { focus: null, view: 'default', ask: false };

/**
 * The person's focus, Home's view and whether the picker should open by
 * itself. A read that fails opens Home on the Default view, without the
 * picker. Who the workspace is to Chat's start (ChatStartAudience) is read
 * only for someone the picker would open for: once, on the first visit; a
 * read of it that fails leaves the picker as it was.
 */
export async function chatFocusState(): Promise<ChatFocusState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NO_FOCUS;
  const prefs = await supabase
    .from('chat_user_prefs')
    .select('focus, focus_prompted_at, home_view')
    .eq('user_id', user.id)
    .maybeSingle();
  if (prefs.error) return NO_FOCUS;
  const focus = focusOf(prefs.data?.focus);
  const firstVisit = focus === null && !prefs.data?.focus_prompted_at;
  return {
    focus,
    view: homeViewOf(prefs.data?.home_view),
    ask: firstVisit && !(await startsOnWelcome(supabase, user.id)),
  };
}

/** The free trial or the demo (ChatStartAudience): Home opens on its welcome card, not the picker. */
async function startsOnWelcome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.organization_id) return false;
    return (await readChatStartAudience(supabase, profile.organization_id)) !== null;
  } catch (error) {
    console.error('[chat] could not read who Chat starts:', error);
    return false;
  }
}

/**
 * The composer's setup: the default mode the person chose in Chat's settings
 * (chat_user_prefs.default_mode; Auto, ask before changes, when none), and
 * Full auto as the server will decide it, the period whose 80% usage line
 * the person already saw, whether Chat runs on the workspace's own key, and
 * the skills in the / menu, their focus's first (CHAT-24 §1). A value that
 * can't be read falls back to the careful one.
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
      .select('default_mode, usage_notice_period, focus, page_open')
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
    // Read only where Chat runs on the own key (AGENT-OWN-KEY §5.2 item 5).
    keyFailure: onOwnKey ? await failingKeyFor(profile.organization_id) : null,
    skills: skillsByFocus(
      await skillMenuFor(profile.organization_id, user.id),
      focusOf(prefs?.focus) ?? [],
    ),
    pageOpen: pageOpenOf(prefs?.page_open),
  };
}
