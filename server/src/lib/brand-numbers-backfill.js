/**
 * The 00534 backfill: numbers each brand's actions (AC-01…) and signals
 * (S-01…) from before 00534, one brand and kind per backfill_brand_numbers
 * call, in creation order, and lists the brand in brand_number_counters
 * with its last number. Until then the app shows the brand's old codes.
 * Run by src/scripts/backfill-brand-numbers.js, which has the options.
 *
 * A call numbers only rows that have no number, after the brand's highest,
 * so it can be run again and changes nothing; a run that stops resumes from
 * the brand it names. Calls go one at a time with a pause, as this shares
 * the instance with live dashboards.
 */

export const BRAND_NUMBER_KINDS = ['action', 'signal'];
export const BRAND_NUMBERS_PAUSE_MS = 100;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk the brands of each kind: those not numbered yet, or `brand` (numbered
 * or not). Brands go by id, so `fromBrand` resumes where a run stopped.
 *
 * @param {object} options
 * @param {(fn: string, args?: object) => PromiseLike<{ data: any, error: any }>} options.rpc
 * @param {string[]} [options.kinds]          'action', 'signal' or both
 * @param {number} [options.pauseMs]          wait after each call
 * @param {string|null} [options.brand]       this brand only
 * @param {string|null} [options.fromBrand]   start at this brand id
 * @param {boolean} [options.dryRun]          log the plan, call nothing
 * @returns {Promise<{ calls: number, numbered: number, ms: number }>}
 */
export async function backfillBrandNumbers({
  rpc,
  kinds = BRAND_NUMBER_KINDS,
  pauseMs = BRAND_NUMBERS_PAUSE_MS,
  brand = null,
  fromBrand = null,
  dryRun = false,
  log = console.log,
  sleep = sleepFor,
  clock = Date.now,
}) {
  const plan = [];
  for (const kind of kinds) {
    const { data, error } = await rpc('brand_numbers_backfill_brands', { p_kind: kind });
    if (error) throw new Error(`brand_numbers_backfill_brands(${kind}): ${error.message}`);
    let brands = data ?? [];
    brands = brand ? brands.filter((b) => b.brand_id === brand) : brands.filter((b) => !b.ready);
    // Postgres orders uuids as their lower-case hex strings sort.
    if (fromBrand) brands = brands.filter((b) => b.brand_id >= fromBrand);
    for (const b of brands) plan.push({ kind, brandId: b.brand_id });
  }
  log(`${plan.length} call(s), ${pauseMs} ms apart${dryRun ? ' (dry run)' : ''}`);
  if (dryRun) return { calls: 0, numbered: 0, ms: 0 };

  const started = clock();
  let numbered = 0;
  for (const [i, { kind, brandId }] of plan.entries()) {
    const t0 = clock();
    const { data, error } = await rpc('backfill_brand_numbers', {
      p_kind: kind,
      p_brand_id: brandId,
    });
    if (error) {
      throw new Error(
        `${kind} ${brandId}: ${error.message}\nResume with: --kind ${kind} --from-brand ${brandId}`,
      );
    }
    numbered += data?.numbered ?? 0;
    log(
      `[${i + 1}/${plan.length}] ${kind} ${brandId} ${clock() - t0} ms · ` +
        `numbered ${data?.numbered ?? 0}, last ${data?.last_no ?? 0}`,
    );
    if (pauseMs > 0) await sleep(pauseMs);
  }
  return { calls: plan.length, numbered, ms: clock() - started };
}
