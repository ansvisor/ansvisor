import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import { TASK_REVIEW_ERROR_STATUS, dismissTaskReviewFor } from '@/lib/mcp/task-reviews';

/** POST /api/mcp/task-reviews/[id]/dismiss — REST mirror of the `dismiss_task_review` MCP tool. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const result = await dismissTaskReviewFor(auth, id);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: TASK_REVIEW_ERROR_STATUS[result.error] },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
