import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeRefusal } from '@/lib/subscription-guard';
import {
  invalidSkillResponse,
  missingSkillResponse,
  skillRefusalResponse,
  skillViewerFor,
} from '@/lib/chat/skills/api';
import {
  addMarketplaceSkill,
  readMarketplaceDetail,
  type MarketplaceDetail,
} from '@/lib/chat/skills/marketplace-store';
import type { ImportedSkill } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * A Library skill, by its catalog id (`owner/repo/folder`; CHAT-17).
 *
 * GET ?id=: its detail (item 9, W4-18): its card, its SKILL.md and license
 * read at the commit the catalog pins, cleaned, and Ansvisor's own scan.
 * Every role reads. A skill GitHub can't give now answers 200 with
 * `read: { ok: false, code, error }`.
 *
 * POST `{ id }`: Add (items 11–13, W4-19). The skill is read at its pinned
 * commit, cleaned and scanned as an import is, and kept off and private
 * for an Admin's review, with its license, source, commit and catalog row
 * (00465). A Manager's Add asks the Admins. Admins and Managers, on a paid
 * plan; once per workspace. Answers `{ ok: true, skill }` as an import.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400,
 * 401, 402 a read-only workspace (before anything else), 403 role or plan,
 * 404 no such skill or Chat off, 409 added already, its name or its
 * license, 413, 429/502 GitHub.
 */

/** A catalog id: owner/repo/folder, as 00465's library_ref takes it. */
const ID = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9._/-]+$/);

export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const id = ID.safeParse(new URL(req.url).searchParams.get('id'));
    if (!id.success) return missingSkillResponse();
    const detail = await readMarketplaceDetail(viewer, id.data);
    if (!detail) return missingSkillResponse();
    return NextResponse.json<{ ok: true; detail: MarketplaceDetail }>({ ok: true, detail });
  } catch (error) {
    console.error('[chat/skills] could not read a Library skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the skill');
  }
}

export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const body = z.strictObject({ id: ID }).safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidSkillResponse();
    const added = await addMarketplaceSkill(viewer, body.data.id);
    if (!added.ok) return skillRefusalResponse(added.refusal);
    return NextResponse.json<{ ok: true; skill: ImportedSkill }>({ ok: true, skill: added.value });
  } catch (error) {
    console.error('[chat/skills] could not add a Library skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to add the skill');
  }
}
