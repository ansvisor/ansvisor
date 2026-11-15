import supabaseAdmin from '../../config/supabase.js';
import { EDITOR, NOTE_COLUMN } from '../../config/ads-editor.js';
import { toCsv } from '../csv.js';
import { extractHostname, ownDomainMatcher } from '../response-parser.js';
import { logAdsActivity } from './activity.js';
import { keptKeywords } from './claims.js';
import { SEARCH_DESCRIPTIONS, SEARCH_HEADLINES, readCompetitors } from './drafts.js';
import { readOpportunities } from './opportunities.js';
import { readOpportunity } from './opportunity.js';
import { NotFound } from './standing.js';

/**
 * Ads' Google Ads Editor CSV (ADS-01 §3.2, §9.3, §7a rules 11 and 16): the
 * Opportunities' rows under a decision filter, or one prompt, built and
 * logged here. Nothing is sent to an ad platform: a person imports the file.
 *
 *  - Campaign: the prompt's topic (the brand's name without one); ad group:
 *    the prompt. Every campaign, ad group, keyword and ad row is Paused.
 *  - Keywords: the prompt's keyword seeds and fan-outs, as its drawer reads
 *    them, in words alone, each once, any naming a competitor dropped (the
 *    claims gate's rule), with the match type in its own column.
 *  - Ads: the prompt's latest saved Google and Microsoft drafts (00532).
 *  - Final URL: the prompt's target page, only on the brand's own domains
 *    (brand_domains: §7a rule 11 in its Phase 0 form). A page off them is
 *    left out and the row says so; the home page of the brand's primary
 *    domain stands in for it, and for a prompt with no target page.
 *  - Logged with the person, the file and its row count; no personal data.
 *
 * Column names are config/ads-editor.js's placeholders, to confirm.
 */

const DRAFT_CHANNELS = { google: 'Google draft', microsoft: 'Microsoft draft' };
/** The prompts whose drawers are read at once, for a filter's export. */
const READS_AT_ONCE = 5;

const numbered = (n, name) => Array.from({ length: n }, (_, i) => name(i + 1));
const HEADLINES = numbered(SEARCH_HEADLINES, EDITOR.headline);
const DESCRIPTIONS = numbered(SEARCH_DESCRIPTIONS, EDITOR.description);
export const EDITOR_HEADERS = [
  EDITOR.campaign,
  EDITOR.adGroup,
  EDITOR.status,
  EDITOR.keyword,
  EDITOR.matchType,
  ...HEADLINES,
  ...DESCRIPTIONS,
  EDITOR.finalUrl,
  NOTE_COLUMN,
];

/** A seed or fan-out as a keyword's words: letters, digits, marks, spaces and ' & . / + - only. */
const keywordOf = (raw) =>
  String(raw ?? '')
    .replace(/[^\p{L}\p{N}\p{M} '&./+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}+]+/u, '');

/** The brand's own domains, within its organization: the primary first. */
async function brandDomains(brandId, orgId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary, brands!inner(organization_id)')
    .eq('brand_id', brandId)
    .eq('brands.organization_id', orgId)
    .order('is_primary', { ascending: false });
  if (error) throw new Error(`brand_domains: ${error.message}`);
  return (data ?? []).map((d) => d.domain).filter(Boolean);
}

/**
 * The file's rows, from each prompt's Opportunities row and drawer read.
 * @param {{ row: object, detail: object }[]} prompts
 * @param {{ brandName: string, competitors: object[], domains: string[] }} context
 */
function editorCsv(prompts, { brandName, competitors, domains }) {
  const ours = ownDomainMatcher(domains);
  const onOurs = (url) => /^https?:\/\//i.test(url) && ours(url);
  const host = domains.length ? (extractHostname(domains[0]) ?? domains[0]) : null;
  const home = host && onOurs(`https://${host}/`) ? `https://${host}/` : '';
  const counts = { prompts: prompts.length, keywords: 0, ads: 0, droppedUrls: 0 };
  const campaigns = new Set();
  const rows = [];
  for (const { row, detail } of prompts) {
    const campaign = row.topic?.name || brandName;
    if (!campaigns.has(campaign)) {
      campaigns.add(campaign);
      rows.push({ [EDITOR.campaign]: campaign, [EDITOR.status]: EDITOR.paused });
    }
    const group = {
      [EDITOR.campaign]: campaign,
      [EDITOR.adGroup]: detail.text || row.text,
      [EDITOR.status]: EDITOR.paused,
    };
    rows.push(group);
    const seeds = [...detail.keywords, ...detail.fanOuts.map((f) => f.query)].map(keywordOf);
    const { keywords } = keptKeywords(seeds, { brandName, competitors });
    for (const keyword of keywords) {
      rows.push({ ...group, [EDITOR.keyword]: keyword, [EDITOR.matchType]: EDITOR.match });
    }
    counts.keywords += keywords.length;

    const page = detail.earn?.page ?? null;
    const dropped = page && !onOurs(page);
    for (const draft of detail.drafts.filter((d) => DRAFT_CHANNELS[d.channel])) {
      const ad = { ...group, [EDITOR.finalUrl]: dropped || !page ? home : page };
      HEADLINES.forEach((h, i) => (ad[h] = draft.headlines[i]));
      DESCRIPTIONS.forEach((d, i) => (ad[d] = draft.descriptions[i]));
      ad[NOTE_COLUMN] = [
        DRAFT_CHANNELS[draft.channel],
        dropped && `Final URL left out, not on your domains: ${page}`,
      ]
        .filter(Boolean)
        .join('. ');
      rows.push(ad);
      counts.ads += 1;
      if (dropped) counts.droppedUrls += 1;
    }
  }
  const csv = toCsv(rows, EDITOR_HEADERS, { keep: [EDITOR.keyword] });
  return { csv, rowCount: rows.length, counts };
}

/** Builds the file from the prompts' rows, logs it, and answers it. */
async function exported({ brand, orgId, userId, rows, period, event, target, fileName }) {
  const read = (row) =>
    readOpportunity({ brand, orgId, promptId: row.promptId, period, drawer: false });
  const prompts = [];
  for (let i = 0; i < rows.length; i += READS_AT_ONCE) {
    const batch = rows.slice(i, i + READS_AT_ONCE);
    const details = await Promise.all(batch.map(read));
    batch.forEach((row, j) => details[j] && prompts.push({ row, detail: details[j] }));
  }
  const [competitors, domains] = await Promise.all([
    readCompetitors(brand.id, orgId),
    brandDomains(brand.id, orgId),
  ]);
  const { csv, rowCount, counts } = editorCsv(prompts, {
    brandName: brand.name ?? '',
    competitors,
    domains,
  });
  // Logged before it is answered: an export the log can't hold isn't given.
  await logAdsActivity({
    orgId,
    brandId: brand.id,
    actor: { userId },
    event,
    target,
    after: counts,
    rowCount,
    fileName,
  });
  return { fileName, csv, rowCount, prompts: counts.prompts, droppedUrls: counts.droppedUrls };
}

const day = (now) => now.toISOString().slice(0, 10);

/** The Opportunities' rows under `decision` ('all': every row) for Google Ads Editor. */
export async function exportEditor({ brand, orgId, userId, decision, period, now = new Date() }) {
  const { rows } = await readOpportunities({ brand, orgId, period, now });
  return exported({
    brand,
    orgId,
    userId,
    rows: decision === 'all' ? rows : rows.filter((r) => r.decision === decision),
    period,
    event: 'export.editor',
    target: { decision, period },
    fileName: `google-ads-editor-${decision.replace('_', '-')}-${day(now)}.csv`,
  });
}

/** One prompt of the brand's Opportunities for Google Ads Editor; any other is not found. */
export async function exportOpportunity({
  brand,
  orgId,
  userId,
  promptId,
  period,
  now = new Date(),
}) {
  const { rows } = await readOpportunities({ brand, orgId, period, now });
  const row = rows.find((r) => r.promptId === promptId);
  if (!row) throw new NotFound('Prompt not found');
  return exported({
    brand,
    orgId,
    userId,
    rows: [row],
    period,
    event: 'export.opportunity',
    target: { promptId, period },
    fileName: `google-ads-editor-prompt-${promptId.slice(0, 8)}-${day(now)}.csv`,
  });
}
