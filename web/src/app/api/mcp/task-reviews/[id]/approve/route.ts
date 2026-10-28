import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcp-auth';
import {
  TASK_REVIEW_ERROR_STATUS,
  approveTaskReviewFor,
  taskReviewEditShape,
} from '@/lib/mcp/task-reviews';

/**
 * POST /api/mcp/task-reviews/[id]/approve — REST mirror of the
 * `approve_task_review` MCP tool, its fields in the JSON body.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = z.object(taskReviewEditShape).safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const result = await approveTaskReviewFor(auth, id, body.data);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: TASK_REVIEW_ERROR_STATUS[result.error] },
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
