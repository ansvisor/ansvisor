import { notFound } from 'next/navigation';
import { LibrarySkill } from '@/components/chat/skills/library-skill';
import { chatPageOpen } from '../../_chat-page-access';

/**
 * A Library skill (CHAT-17 item 9, Chat Wave 4 W4-18): `?skill=` names it
 * by its catalog id (owner/repo/folder). Its SKILL.md at the pinned commit,
 * Ansvisor's scan, its license and source, and Add. Every role reads; the
 * API says who may add. Only with the new Chat on for the workspace.
 */
export default async function ChatLibrarySkillPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const { skill } = await searchParams;
  if (typeof skill !== 'string' || !skill) notFound();
  return <LibrarySkill id={skill} />;
}
