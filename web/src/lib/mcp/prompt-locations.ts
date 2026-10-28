import { supabaseAdmin } from '@/lib/supabase/admin';
import { withDbClient, type dbClient } from '@/lib/supabase/scoped';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { getPromptLocationMatrix } from '@/lib/actions/prompt';
import {
  LOCATION_METRICS,
  MATRIX_REGIONS,
  locationAverages,
  matrixInsights,
  matrixLocations,
  metricValue,
  rowGap,
  type PromptLocationCell,
} from '@/lib/prompt-location-matrix';
import { isValidLocation, regionLabel } from '@/lib/region';
import { brandInOrg } from './data';

/**
 * The Tracked Prompts Locations view (PROMPT-015b) for the MCP tool
 * get_prompt_locations and its REST mirror (MCP plan B7): each tracked prompt
 * in each location side by side, as the view reads it (getPromptLocationMatrix,
 * run under the service role once the brand is the key's), with its averages
 * and the three cards above it.
 */

/** One prompt in one location. */
export interface McpLocationCell {
  /** AI Visibility Score, 0–100; null without answers. */
  visibility: number | null;
  mentions: number;
  citations: number;
  /** Average position the brand is named at; null when never named. */
  position: number | null;
  runs: number;
}

export interface McpPromptLocations {
  window: { from: string; to: string | null };
  /** The locations compared: country, US state or city codes, with their names. */
  locations: { code: string; name: string }[];
  /** Each metric's average per location, over the prompts with a value there (in `locations` order). */
  averages: Record<string, (number | null)[]>;
  /** The weakest and strongest location by visibility, and the prompt that differs most between them. */
  insights: ReturnType<typeof matrixInsights>;
  /** The brand's tracked prompts. */
  total: number;
  prompts: {
    id: string;
    text: string;
    is_active: boolean;
    /** The compared locations it tracks. */
    tracked_in: string[];
    /** By location code: its figures there; a location it has no answers in is left out. */
    cells: Record<string, McpLocationCell>;
    /** Best minus worst location's visibility; null with fewer than two. */
    visibility_gap: number | null;
  }[];
  /** The offset of the next page of prompts; null on the last. */
  next_offset: number | null;
}

const PROMPTS_DEFAULT = 50;
const PROMPT_PAGE = 1000;
const PROMPTS_MAX = 200;

function mcpCell(cell: PromptLocationCell): McpLocationCell {
  return {
    visibility: cell.score,
    mentions: cell.mentions,
    citations: cell.citations,
    position: cell.position,
    runs: cell.runs,
  };
}

/**
 * The brand's prompts across its locations over `days` (or `from`–`to`):
 * the locations given (at most 12), else those its prompts track, the most
 * tracked first. Null for a brand outside the key's organization.
 */
export async function getPromptLocationsFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    days?: number;
    from?: string;
    to?: string;
    locations?: string[];
    limit?: number;
    offset?: number;
  },
): Promise<McpPromptLocations | null> {
  if (!(await brandInOrg(auth, params.brandId))) return null;

  // Every prompt, a page at a time: PostgREST answers 1,000 rows at most.
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += PROMPT_PAGE) {
    const { data, error } = await supabaseAdmin
      .from('prompts')
      .select('id, text, regions, is_active, created_at, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', params.brandId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(start, start + PROMPT_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PROMPT_PAGE) break;
  }
  const prompts = rows.map((p) => ({
    id: p.id as string,
    text: p.text as string,
    regions: ((p.regions as string[] | null) ?? []).filter(isValidLocation),
    isActive: p.is_active !== false,
  }));

  const asked = (params.locations ?? []).filter(isValidLocation);
  const regions = asked.length
    ? [...new Set(asked)].slice(0, MATRIX_REGIONS)
    : matrixLocations(prompts);
  const days = params.days ?? 30;
  const from = params.from ?? new Date(Date.now() - days * 86_400_000).toISOString();
  const matrix = regions.length
    ? await withDbClient(supabaseAdmin as unknown as Awaited<ReturnType<typeof dbClient>>, () =>
        getPromptLocationMatrix(params.brandId, {
          days,
          from: params.from,
          to: params.to,
          regions,
        }),
      )
    : {};

  const ids = prompts.map((p) => p.id);
  const limit = Math.min(Math.max(params.limit ?? PROMPTS_DEFAULT, 1), PROMPTS_MAX);
  const offset = Math.max(params.offset ?? 0, 0);
  const page = prompts.slice(offset, offset + limit);
  return {
    window: { from, to: params.to ?? null },
    locations: regions.map((code) => ({ code, name: regionLabel(code) })),
    averages: Object.fromEntries(
      LOCATION_METRICS.map((metric) => [metric, locationAverages(matrix, ids, regions, metric)]),
    ),
    insights: matrixInsights(matrix, prompts, regions),
    total: prompts.length,
    prompts: page.map((p) => {
      const cells = matrix[p.id] ?? {};
      return {
        id: p.id,
        text: p.text,
        is_active: p.isActive,
        tracked_in: regions.filter((r) => p.regions.includes(r)),
        cells: Object.fromEntries(
          regions.filter((r) => cells[r]).map((r) => [r, mcpCell(cells[r])]),
        ),
        visibility_gap: rowGap(regions.map((r) => metricValue(cells[r], 'visibility'))),
      };
    }),
    next_offset: offset + page.length < prompts.length ? offset + page.length : null,
  };
}
