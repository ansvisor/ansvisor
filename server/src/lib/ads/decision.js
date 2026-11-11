import { adsThresholds } from '../../config/ads.js';

/**
 * Earn or pay (ADS-01 §2): for one buying-intent prompt, whether to earn the
 * AI answer with content, pay for an ad, do both, or look at what is paid
 * where we are already cited. A recommendation: the person can change it per
 * prompt.
 *
 *   §2 situation                                         decision   rule
 *   We lead, but a rival pays on it                      pay        defend
 *   We pay, but we are already cited                     overlap    overlap
 *   A rival leads and the prompt has volume              earn_pay   rival_leads
 *   We are cited (or lead) and no rival pays             earn       protect
 *   No one leads and no one pays                         earn       open
 *     ... paid only above the volume threshold           earn_pay   open
 *
 * Checked in that order, so where two rows fit, the one above wins: a rival
 * paying on a prompt we lead is defended, not counted as overlap. Two cases
 * §2 doesn't name follow the nearest row: a rival leading with too little
 * (or unmeasured) volume is earn (rival_leads), and a rival paying where no
 * one leads is earn, or earn_pay from the volume threshold (rival_pays).
 *
 * Paid is "not measured" (null) until sponsored units are captured, which
 * happens only with Ads on (owner, 2026-11-11), so null is today's normal
 * case. Pay (defend) needs a rival's ads measured and seen; overlap needs
 * ours seen and a rival's measured. Otherwise the rule says neither, and it
 * says what paid wasn't measured (paid_not_measured).
 *
 * Paying needs somewhere to pay: the channels come from the engines the
 * prompt is tracked on (channelsFor). Where none carries ads, the pay part is
 * dropped and the rule says why (no_ad_channel).
 *
 * Reasons are fact codes with their values, for the web to word (i18n), never
 * sentences. Pure: no reads, no clock.
 */

/** @typedef {'earn' | 'pay' | 'earn_pay' | 'overlap'} Decision */
/** @typedef {'defend' | 'overlap' | 'rival_leads' | 'protect' | 'rival_pays' | 'open'} Rule */
/** @typedef {'chatgpt' | 'google' | 'microsoft'} Channel */

export const DECISIONS = Object.freeze(['earn', 'pay', 'earn_pay', 'overlap']);

export const RULES = Object.freeze([
  'defend',
  'overlap',
  'rival_leads',
  'protect',
  'rival_pays',
  'open',
]);

/** Every fact code a reason can carry. */
export const REASON_CODES = Object.freeze([
  'we_lead',
  'we_cited',
  'rival_leads',
  'no_leader',
  'rival_pays',
  'no_rival_pays',
  'we_pay',
  'paid_not_measured',
  'volume_at_least',
  'volume_below',
  'volume_not_measured',
  'no_ad_channel',
]);

/**
 * The ad channel whose ads can show beside each tracked engine's answers:
 * - ChatGPT (chatgpt-web, and its Shopping answers): ChatGPT's ads;
 * - Google AI Overviews and AI Mode (google-aio, google-aimode): Google
 *   Search ads, which are eligible to show in both;
 * - Bing AI Mode, the Copilot answer (copilot-web): Microsoft Advertising.
 * Claude (an API answer with text and citations only) and Gemini carry no
 * ads, and neither does an engine not listed here: they are named in
 * `noAdChannel`, never given a channel.
 */
export const AD_CHANNELS = Object.freeze({
  'chatgpt-web': 'chatgpt',
  'chatgpt-shopping': 'chatgpt',
  'google-aio': 'google',
  'google-aimode': 'google',
  'copilot-web': 'microsoft',
});

/** ChatGPT, Google, Microsoft (owner A3). */
const CHANNEL_ORDER = ['chatgpt', 'google', 'microsoft'];

/**
 * The ad channels a prompt's engines reach, and the engines that carry none.
 * @param {string[] | null | undefined} engines prompts.platforms (and `claude`)
 * @returns {{ channels: Channel[], noAdChannel: string[] }}
 */
export function channelsFor(engines) {
  const reached = new Set();
  const noAdChannel = [];
  for (const engine of new Set(Array.isArray(engines) ? engines : [])) {
    if (typeof engine !== 'string' || !engine) continue;
    if (Object.hasOwn(AD_CHANNELS, engine)) reached.add(AD_CHANNELS[engine]);
    else noAdChannel.push(engine);
  }
  return { channels: CHANNEL_ORDER.filter((c) => reached.has(c)), noAdChannel };
}

/** true, false, or null for not measured (anything else). */
const measured = (value) => (value === true ? true : value === false ? false : null);

/** A count we can compare, or null. */
const countOrNull = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * @param {{
 *   weCited?: boolean,
 *   ourPosition?: number | null,
 *   leader?: string | null,
 *   rivalPays?: boolean | null,
 *   wePay?: boolean | null,
 *   volume?: number | null,
 *   engines?: string[],
 * }} standing
 *   weCited: our pages are cited in the prompt's answers;
 *   ourPosition: where AI names us, 1 = first; null when it doesn't;
 *   leader: who AI picks first: 'us', a competitor's id, or 'none';
 *   rivalPays / wePay: true, false, or null = not measured;
 *   volume: Google searches a month (total_google_volume); null = not measured;
 *   engines: the engines the prompt is tracked on (prompts.platforms).
 * @param {object} [overrides] the workspace's thresholds (config/ads.js)
 * @returns {{
 *   decision: Decision,
 *   rule: Rule,
 *   reasons: Array<{ code: string, [key: string]: unknown }>,
 *   channels: Channel[],
 *   noAdChannel: string[],
 *   paidMeasured: boolean,
 * }}
 */
export function earnOrPay(standing = {}, overrides) {
  const t = adsThresholds(overrides);
  const weCited = standing.weCited === true;
  const position = countOrNull(standing.ourPosition);
  const ourPosition = position !== null && position >= 1 ? position : null;
  const leader =
    typeof standing.leader === 'string' && standing.leader.trim() ? standing.leader.trim() : 'none';
  const rivalPays = measured(standing.rivalPays);
  const wePay = measured(standing.wePay);
  const volume = countOrNull(standing.volume);
  const { channels, noAdChannel } = channelsFor(standing.engines);

  const weLead = leader === 'us' || (ourPosition !== null && ourPosition <= t.leadPosition);
  const rivalLeads = !weLead && leader !== 'us' && leader !== 'none';
  const hasVolume = volume !== null && volume >= t.minPaidVolume;

  const lead = { code: 'we_lead', position: ourPosition };
  const cited = { code: 'we_cited' };
  const volumeFact =
    volume === null
      ? { code: 'volume_not_measured', threshold: t.minPaidVolume }
      : {
          code: hasVolume ? 'volume_at_least' : 'volume_below',
          volume,
          threshold: t.minPaidVolume,
        };
  const noRivalPays = rivalPays === false ? [{ code: 'no_rival_pays' }] : [];

  /** @type {Rule} */
  let rule;
  /** @type {Decision} */
  let decision;
  let reasons;
  if (weLead && rivalPays === true) {
    rule = 'defend';
    decision = 'pay';
    reasons = [lead, { code: 'rival_pays' }];
  } else if (wePay === true && weCited && rivalPays !== null) {
    // Overlap needs both measured: while a rival's ads aren't, our paying
    // may be defending, and can't be called a saving.
    rule = 'overlap';
    decision = 'overlap';
    reasons = [{ code: 'we_pay' }, cited];
  } else if (rivalLeads) {
    rule = 'rival_leads';
    decision = hasVolume ? 'earn_pay' : 'earn';
    reasons = [{ code: 'rival_leads', competitorId: leader }, volumeFact];
  } else if ((weCited || weLead) && rivalPays !== true) {
    rule = 'protect';
    decision = 'earn';
    reasons = [...(weLead ? [lead] : []), ...(weCited ? [cited] : []), ...noRivalPays];
  } else if (rivalPays === true) {
    rule = 'rival_pays';
    decision = hasVolume ? 'earn_pay' : 'earn';
    reasons = [
      { code: 'no_leader' },
      ...(weCited ? [cited] : []),
      { code: 'rival_pays' },
      volumeFact,
    ];
  } else {
    rule = 'open';
    decision = hasVolume ? 'earn_pay' : 'earn';
    reasons = [{ code: 'no_leader' }, ...noRivalPays, volumeFact];
  }

  if (wePay === true && rule !== 'overlap') reasons.push({ code: 'we_pay' });
  const paidMeasured = rivalPays !== null && wePay !== null;
  if (!paidMeasured) {
    reasons.push({
      code: 'paid_not_measured',
      rivalPays: rivalPays === null,
      wePay: wePay === null,
    });
  }

  const pays = decision === 'pay' || decision === 'earn_pay';
  if (pays && channels.length === 0) {
    decision = 'earn';
    reasons.push({ code: 'no_ad_channel', engines: noAdChannel });
  }

  return {
    decision,
    rule,
    reasons,
    channels: decision === 'pay' || decision === 'earn_pay' ? channels : [],
    noAdChannel,
    paidMeasured,
  };
}
