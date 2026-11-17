import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getPromptsPageData } from '@/lib/actions/prompt';
import { getPromptVolumes, getVolumeAnalysisStatus } from '@/lib/actions/volumes';

/**
 * POST /api/prompts/read — one of Tracked Prompts' reads, by name, with the
 * server action's own arguments (lib/prompts-reads.ts). A route because the
 * browser runs fetches side by side, where Next runs a page's server
 * actions one at a time: the table's read no longer waits behind them.
 *
 * Reads through the signed-in member's session, as the actions do, so RLS
 * and the functions' brand checks decide whose brand this is.
 */

export const runtime = 'nodejs';

/** A read slower than this is logged as a warning, not as info. */
const SLOW_READ_MS = 2000;

// getPromptsPageData's options (PromptsPageDataOptions). JSON has no
// undefined: an option left out arrives as null, and is passed as undefined.
const pageDataOptions = z
  .object({
    days: z.number().int().min(1).max(3650).nullish(),
    from: z.string().max(40).nullish(),
    to: z.string().max(40).nullish(),
    region: z.string().max(32).nullish(),
    first: z.boolean().nullish(),
    withoutAnswers: z.boolean().nullish(),
    volumes: z.boolean().nullish(),
  })
  .strict()
  .nullish();

// The names are lib/prompts-reads.ts's; each takes the brand first.
const body = z.discriminatedUnion('read', [
  z.object({
    read: z.literal('pageData'),
    args: z.union([z.tuple([z.guid()]), z.tuple([z.guid(), pageDataOptions])]),
  }),
  z.object({ read: z.literal('volumes'), args: z.tuple([z.guid()]) }),
]);

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { read } = parsed.data;
  const [brandId] = parsed.data.args;
  let run: () => Promise<unknown>;
  if (parsed.data.read === 'pageData') {
    const options = parsed.data.args[1];
    run = () =>
      getPromptsPageData(
        brandId,
        options
          ? {
              days: orUndefined(options.days),
              from: orUndefined(options.from),
              to: orUndefined(options.to),
              region: orUndefined(options.region),
              first: orUndefined(options.first),
              withoutAnswers: orUndefined(options.withoutAnswers),
              volumes: orUndefined(options.volumes),
            }
          : undefined,
      );
  } else {
    // The volumes, and whether an analysis is running for the brand (null
    // when that can't be read), side by side: the page's "Analyzing…" on arrival.
    run = async () => {
      const [read, status] = await Promise.all([
        getPromptVolumes(brandId),
        getVolumeAnalysisStatus(brandId).catch(() => null),
      ]);
      return { ...read, status };
    };
  }

  // One log line a read, with how long it took, so a slow one shows.
  const started = performance.now();
  const took = () => Math.round(performance.now() - started);
  try {
    const data = await run();
    const ms = took();
    if (ms > SLOW_READ_MS) console.warn(`[prompts/read] ${read} ${ms}ms (slow)`);
    else console.info(`[prompts/read] ${read} ${ms}ms`);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // The page shows its own failed state, with Retry; the details stay in the log.
    console.error(`[prompts/read] ${read} failed after ${took()}ms:`, err);
    return Response.json({ error: 'Failed to load' }, { status: 500 });
  }
}
