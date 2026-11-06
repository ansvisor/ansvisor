'use server';

import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { canAccessBrand } from '@/lib/brand-access';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { ANSWER_LANGUAGES, type AnswerLanguage } from '@/lib/chat/general-settings';
import { isTourTopic, TOUR_PAGES, TOUR_VIAS, type TourTopic } from '@/lib/chat/tour';
import { getTrackingWindow } from '@/lib/actions/tracking';
import {
  endTurn,
  firstRunLine,
  topicTurn,
  tourTexts,
  type FirstRunNote,
} from '@/lib/chat/tour-script';
import { startTouchedBrands } from '@/lib/chat/touched-brands';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * The product tour's turns (owner decision 2026-11-06; 00486), kept as the
 * person's "Ansvisor tour" chat in their Chats: each topic adds the line
 * they clicked and the page's explanation, scripted (lib/chat/tour-script.ts)
 * and with no run, so a tour costs no AI. The chat is the person's own and
 * written by the server, as every chat; a question typed in it afterwards
 * goes to Chat as in any chat. The tour's place is kept on the person
 * (chat_user_prefs.tour_chat_id, tour_topic, tour_finished_at).
 *
 * Open while the workspace is read-only and on the demo brand: the tour is
 * how a new workspace meets the product, and nothing in it runs or costs.
 * Answers as values, never throws (#1777).
 */

export type ChatTourResult = { ok: true; chatId: string | null } | { ok: false };

const t = createTranslator({ locale: 'en', messages, namespace: 'chatTour' });

type Person = { userId: string; orgId: string };

/** The signed-in person with the new Chat on for their workspace, or null. */
async function tourPerson(): Promise<Person | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id ?? null;
  if (!orgId || !chatAgenticEnabled(orgId)) return null;
  return { userId: user.id, orgId };
}

/**
 * The person's tour chat to add to, and their answer language: the chat
 * their prefs name while it is still theirs, there and not archived; null
 * to start one.
 */
async function readTour(
  person: Person,
): Promise<{ chatId: string | null; language: AnswerLanguage | null }> {
  const { data: prefs, error } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('tour_chat_id, answer_language')
    .eq('user_id', person.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the tour: ${error.message}`);
  const language = ANSWER_LANGUAGES.find((l) => l === prefs?.answer_language) ?? null;
  if (!prefs?.tour_chat_id) return { chatId: null, language };
  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chat_conversations')
    .select('id')
    .eq('id', prefs.tour_chat_id)
    .eq('user_id', person.userId)
    .eq('organization_id', person.orgId)
    .is('deleted_at', null)
    .is('archived_at', null)
    .maybeSingle();
  if (chatError) throw new Error(`Could not read the tour's chat: ${chatError.message}`);
  return { chatId: chat ? prefs.tour_chat_id : null, language };
}

/**
 * A new "Ansvisor tour" chat, opened in the side panel on the topic's page:
 * about the brand on screen when the person may use it, else the workspace.
 */
async function startTourChat(person: Person, brandId: string | null, topic: TourTopic) {
  const brand =
    brandId && (await canAccessBrand(person.userId, brandId, person.orgId)) ? brandId : null;
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .insert({
      organization_id: person.orgId,
      user_id: person.userId,
      brand_id: brand,
      title: t('chatTitle'),
      origin: 'panel',
      origin_page: TOUR_PAGES[topic],
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not start the tour's chat: ${error?.message}`);
  // It keeps the brands it touches from the start (00436), as every new chat.
  await startTouchedBrands(data.id);
  return data.id;
}

/**
 * The person's line and its answer, in one statement: they come in order
 * (00400). A topic's line keeps its topic as its scope (context_json), so
 * the side panel finds the turn about the page on screen.
 */
async function addTurn(
  chatId: string,
  turn: { question: string; answer: string },
  topic: TourTopic | null,
) {
  const { error } = await supabaseAdmin.from('chat_messages').insert([
    {
      conversation_id: chatId,
      role: 'user',
      content_md: turn.question,
      context_json: topic ? { tour: topic } : null,
    },
    { conversation_id: chatId, role: 'assistant', content_md: turn.answer },
  ]);
  if (error) throw new Error(`Could not add the tour's turn: ${error.message}`);
}

/** Keeps where the tour is on the person, for every device. */
async function keepTour(
  person: Person,
  row: { tour_chat_id?: string | null; tour_topic?: TourTopic; tour_finished_at: string | null },
) {
  const { error } = await supabaseAdmin
    .from('chat_user_prefs')
    .upsert({ user_id: person.userId, ...row }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not keep the tour: ${error.message}`);
}

/**
 * While the brand's first tracking run goes on, about when its first results
 * are in; null once it has a completed run, or when none goes on. The
 * browser says what it saw (useFirstRun's time left, which only it keeps);
 * the brand's runs say whether it still holds. A read that fails says none.
 */
async function firstRunOf(
  brandId: string | null,
  seen: { minutes?: unknown } | null | undefined,
): Promise<FirstRunNote | null> {
  if (!brandId) return null;
  const tracking = await getTrackingWindow(brandId).catch(() => null);
  if (!tracking || tracking.lastRunAt || !(tracking.activeRun || seen)) return null;
  const minutes = typeof seen?.minutes === 'number' ? seen.minutes : null;
  return { minutes: minutes !== null && minutes > 0 && minutes < 10_000 ? minutes : null };
}

/**
 * A topic of the tour: its turn added to the person's tour chat (started on
 * the first one, about `brandId`), and the tour on it, not ended. While the
 * brand's first tracking run goes on, the turn ends with when its first
 * results are in (`firstRun`, what the browser saw of it). Answers the
 * chat's id, which the side panel opens beside the topic's page.
 */
export async function showTourTopic(input: {
  topic: unknown;
  via: unknown;
  brandId?: string | null;
  firstRun?: { minutes?: unknown } | null;
}): Promise<ChatTourResult> {
  try {
    const topic = input?.topic;
    const via = TOUR_VIAS.find((v) => v === input?.via);
    if (!isTourTopic(topic) || !via) return { ok: false };
    const person = await tourPerson();
    if (!person) return { ok: false };
    const brandId = typeof input.brandId === 'string' ? input.brandId : null;
    const [tour, firstRun] = await Promise.all([
      readTour(person),
      firstRunOf(brandId, input.firstRun),
    ]);
    const texts = await tourTexts(tour.language);
    const chatId = tour.chatId ?? (await startTourChat(person, brandId, topic));
    const turn = topicTurn(texts, topic, via);
    await addTurn(
      chatId,
      firstRun ? { ...turn, answer: `${turn.answer}\n\n${firstRunLine(texts, firstRun)}` } : turn,
      topic,
    );
    await keepTour(person, { tour_chat_id: chatId, tour_topic: topic, tour_finished_at: null });
    return { ok: true, chatId };
  } catch (error) {
    console.error('[chat/tour] could not show a topic:', error);
    return { ok: false };
  }
}

/**
 * End the tour: its last turn (where Chat is from now on) added to the tour
 * chat, and the tour kept as ended, so the welcome card hides. Answers the
 * chat's id; null when the chat is gone, and the tour ends all the same.
 */
export async function endChatTour(): Promise<ChatTourResult> {
  try {
    const person = await tourPerson();
    if (!person) return { ok: false };
    const tour = await readTour(person);
    if (tour.chatId) await addTurn(tour.chatId, endTurn(await tourTexts(tour.language)), null);
    await keepTour(person, { tour_finished_at: new Date().toISOString() });
    return { ok: true, chatId: tour.chatId };
  } catch (error) {
    console.error('[chat/tour] could not end the tour:', error);
    return { ok: false };
  }
}

/**
 * The tour's texts in the person's language made ahead, while the welcome
 * card shows: the first topic then opens without waiting for the
 * translation. English needs nothing. Never throws.
 */
export async function prepareChatTour(): Promise<void> {
  try {
    const person = await tourPerson();
    if (!person) return;
    const { data } = await supabaseAdmin
      .from('chat_user_prefs')
      .select('answer_language')
      .eq('user_id', person.userId)
      .maybeSingle();
    const language = ANSWER_LANGUAGES.find((l) => l === data?.answer_language) ?? null;
    if (language && language !== 'en') await tourTexts(language);
  } catch (error) {
    console.error('[chat/tour] could not prepare the tour:', error);
  }
}
