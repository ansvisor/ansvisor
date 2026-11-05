// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * render_audit takes the score's range from get_site_audit as it is, so the
 * Agent's audit card can show "64 ± 2"; an audit without one, or a call made
 * before it, still renders.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));

const { buildAgentTools } = await import('./tools');

const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};

const schema = buildAgentTools(AUTH).render_audit.inputSchema as z.ZodType;

const audit = {
  url: 'https://shop.com/bags',
  totalScore: 0.64,
  categoryScores: {},
  recommendations: [],
  signalsEvaluated: 45,
  signalsTotal: 48,
};

describe('render_audit', () => {
  it("takes get_site_audit's scoreRange, null, or none", () => {
    const scoreRange = { plusMinus: 2, low: 62, high: 66, audits: 5 };
    expect(schema.parse({ ...audit, scoreRange })).toMatchObject({ scoreRange });
    expect(schema.safeParse({ ...audit, scoreRange: null }).success).toBe(true);
    expect(schema.safeParse(audit).success).toBe(true);
  });

  it('refuses a range that is not one', () => {
    expect(schema.safeParse({ ...audit, scoreRange: '± 2' }).success).toBe(false);
    expect(schema.safeParse({ ...audit, scoreRange: { plusMinus: 2 } }).success).toBe(false);
  });
});
