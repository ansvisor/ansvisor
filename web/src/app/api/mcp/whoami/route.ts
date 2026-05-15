import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcp-auth';

export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    userId: auth.userId,
    email: auth.email,
    organizationId: auth.organizationId,
  });
}
