/**
 * Ads' tabs (ADS-01 §3, mockup): each kept in the address's hash, as the
 * mockup has them, so a link can open one: `#ov` Overview (the default),
 * `#op` Opportunities, `#sov` Paid SoV, `#cmp` Campaigns, `#con` Connections.
 */
export const ADS_TABS = ['ov', 'op', 'sov', 'cmp', 'con'] as const;
export type AdsTab = (typeof ADS_TABS)[number];

export const DEFAULT_ADS_TAB: AdsTab = 'ov';

/** The tab a hash names ("#op" or "op"); the Overview for any other. */
export function adsTabOf(hash: string | null | undefined): AdsTab {
  const id = (hash ?? '').replace(/^#/, '');
  return (ADS_TABS as readonly string[]).includes(id) ? (id as AdsTab) : DEFAULT_ADS_TAB;
}

/** The period switch beside the tabs (§3): 30 days until a person picks another. */
export const ADS_PERIODS = ['7d', '30d', '90d'] as const;
export type AdsPeriod = (typeof ADS_PERIODS)[number];
export const DEFAULT_ADS_PERIOD: AdsPeriod = '30d';
