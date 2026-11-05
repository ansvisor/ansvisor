import { NextResponse } from 'next/server';
import { skillViewerFor } from '@/lib/chat/skills/api';
import {
  listMarketplace,
  marketplaceQuery,
  type MarketplacePage,
} from '@/lib/chat/skills/marketplace-store';
import { chatActor, runFailure } from '@/lib/chat/run-api';

/**
 * GET /api/chat/skills/marketplace?topic=&sort=stars|installs&q=&offset=
 *
 * The Library's cards (CHAT-17 items 1–6, W4-18): the third-party catalog
 * of MIT skills, by topic, search and sort, 30 at a time, with the
 * workspace's copy of each it added (W4-19) and whether the person may
 * add. Meta data only: no SKILL.md is read. Every role reads.
 *
 * Answers `{ ok: true, skills, total, next, counts, can }`. Refusals as
 * values (`{ ok: false, failure, code, error }`, #1777): 401 no session,
 * 404 Chat off for the workspace (CHAT_AGENTIC).
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const page = await listMarketplace(viewer, marketplaceQuery(new URL(req.url).searchParams));
    return NextResponse.json<{ ok: true } & MarketplacePage>({ ok: true, ...page });
  } catch (error) {
    console.error('[chat/skills] could not list the Library:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the Library');
  }
}
