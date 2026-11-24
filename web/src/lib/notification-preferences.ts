/**
 * A person's own e-mail choices (Settings › Notifications, "Your e-mails",
 * 00554): which e-mails Ansvisor sends them and how often, for All my brands
 * or one brand, and the rules shared by the page and its server actions.
 *
 * Until someone saves, their choices are carried over from the brand's
 * pulse_settings (carryOverChoices), the same rule the Pulse and AI Traffic
 * digest senders use for them, so nobody's e-mail changes by itself.
 */

export const NOTIFICATION_FREQUENCIES = [
  'instant',
  'daily',
  'weekly',
  'notable',
  'on',
  'off',
] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export type NotificationDelivery = 'per_brand' | 'combined';

export const NOTIFICATION_GROUPS = [
  'visibility',
  'traffic',
  'actions',
  'agents',
  'audit',
  'content',
  'account',
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_KINDS = [
  'daily_pulse',
  'traffic_digest',
  'critical_action',
  'due_actions',
  'weekly_actions',
  'run_finished',
  'audit_finished',
  'score_dropped',
  'drafts_review',
  'ai_usage',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationKindSpec {
  kind: NotificationKind;
  group: NotificationGroup;
  /** The choices offered, in order. */
  options: readonly NotificationFrequency[];
  /** Which words the choices take on the page (messages settings.yourEmails.options). */
  labels: 'pulse' | 'instant' | 'digest' | 'weekly' | 'onoff';
  /** A new person's choice. */
  fallback: NotificationFrequency;
  /** Set per brand (All my brands, or one brand); else the workspace's, Account e-mails. */
  brandScoped: boolean;
  /** No sender yet: saved, and sent once a later release adds it. */
  comingSoon: boolean;
}

const INSTANT = ['instant', 'daily', 'off'] as const;
const DIGEST = ['daily', 'weekly', 'off'] as const;
const WEEKLY = ['weekly', 'off'] as const;

/** The e-mails a person picks, in the page's order. */
export const NOTIFICATION_KIND_SPECS: readonly NotificationKindSpec[] = [
  {
    kind: 'daily_pulse',
    group: 'visibility',
    options: ['daily', 'weekly', 'notable', 'off'],
    labels: 'pulse',
    fallback: 'notable',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'traffic_digest',
    group: 'traffic',
    options: WEEKLY,
    labels: 'weekly',
    fallback: 'weekly',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'critical_action',
    group: 'actions',
    options: INSTANT,
    labels: 'instant',
    fallback: 'off',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'due_actions',
    group: 'actions',
    options: DIGEST,
    labels: 'digest',
    fallback: 'weekly',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'weekly_actions',
    group: 'actions',
    options: WEEKLY,
    labels: 'weekly',
    fallback: 'weekly',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'run_finished',
    group: 'agents',
    options: INSTANT,
    labels: 'instant',
    fallback: 'off',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'audit_finished',
    group: 'audit',
    options: INSTANT,
    labels: 'instant',
    fallback: 'off',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'score_dropped',
    group: 'audit',
    options: INSTANT,
    labels: 'instant',
    fallback: 'off',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'drafts_review',
    group: 'content',
    options: DIGEST,
    labels: 'digest',
    fallback: 'weekly',
    brandScoped: true,
    comingSoon: false,
  },
  {
    kind: 'ai_usage',
    group: 'account',
    options: ['on', 'off'],
    labels: 'onoff',
    fallback: 'on',
    brandScoped: false,
    comingSoon: false,
  },
];

const SPEC_BY_KIND = new Map(NOTIFICATION_KIND_SPECS.map((spec) => [spec.kind, spec]));

export function kindSpec(kind: NotificationKind): NotificationKindSpec {
  return SPEC_BY_KIND.get(kind)!;
}

/** Account e-mails: only Admins pick them. */
export const ADMIN_ONLY_KINDS: readonly NotificationKind[] = ['ai_usage'];

export interface NotificationChoices {
  /** Each kind's choice for All my brands (and the Account e-mails). */
  all: Record<NotificationKind, NotificationFrequency>;
  /** A brand's choices where they differ from All my brands: brand id → kind → choice. */
  brands: Record<string, Partial<Record<NotificationKind, NotificationFrequency>>>;
  delivery: NotificationDelivery;
}

/** A saved row, as notification_preferences holds it. */
export interface NotificationPreferenceRow {
  kind: string;
  brand_id: string | null;
  frequency: string;
  delivery?: string | null;
}

/** A brand's Pulse settings (pulse_settings, 00036 and 00187), as the carry-over reads them. */
export interface LegacyPulseSettings {
  frequency?: string | null;
  recipients?: string[] | null;
  traffic_digest?: boolean | null;
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && SPEC_BY_KIND.has(value as NotificationKind);
}

/** Whether `frequency` is one of the kind's choices. */
export function fitsKind(
  kind: NotificationKind,
  frequency: unknown,
): frequency is NotificationFrequency {
  return kindSpec(kind).options.includes(frequency as NotificationFrequency);
}

export function defaultChoices(): NotificationChoices {
  return {
    all: Object.fromEntries(
      NOTIFICATION_KIND_SPECS.map((spec) => [spec.kind, spec.fallback]),
    ) as NotificationChoices['all'],
    brands: {},
    delivery: 'per_brand',
  };
}

const sameAddress = (address: string) => address.trim().toLowerCase();

/**
 * What a brand's Pulse settings give a member today, by the rule the senders
 * used before 00554: an empty list is everyone who can see the brand, else
 * only the addresses on it; at the brand's frequency ('notable' with no
 * settings); the digest too, unless it or the Pulse is off.
 */
export function legacyChoices(
  settings: LegacyPulseSettings | null | undefined,
  email: string | null | undefined,
): { daily_pulse: NotificationFrequency; traffic_digest: NotificationFrequency } {
  const list = settings?.recipients ?? [];
  const listed =
    list.length === 0 ||
    (!!email && list.some((address) => sameAddress(address) === sameAddress(email)));
  const frequency = (settings?.frequency ?? 'notable') as NotificationFrequency;
  const pulse: NotificationFrequency =
    listed && fitsKind('daily_pulse', frequency) ? frequency : 'off';
  const digest: NotificationFrequency =
    pulse !== 'off' && settings?.traffic_digest !== false ? 'weekly' : 'off';
  return { daily_pulse: pulse, traffic_digest: digest };
}

/** The value most brands share (the first brand's on a tie). */
function commonest<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  for (const value of values) if (counts.get(value)! > counts.get(best)!) best = value;
  return best;
}

/**
 * A person's starting choices before they save any: the defaults, with the
 * Daily Pulse and the AI Traffic digest as each of their brands sends them
 * today. All my brands takes what most brands give; the others are kept
 * per brand.
 */
export function carryOverChoices(
  brandIds: string[],
  settingsByBrand: Map<string, LegacyPulseSettings>,
  email: string | null | undefined,
): NotificationChoices {
  const choices = defaultChoices();
  if (brandIds.length === 0) return choices;
  const perBrand = brandIds.map(
    (id) => [id, legacyChoices(settingsByBrand.get(id), email)] as const,
  );
  for (const kind of ['daily_pulse', 'traffic_digest'] as const) {
    const all = commonest(perBrand.map(([, legacy]) => legacy[kind]));
    choices.all[kind] = all;
    for (const [id, legacy] of perBrand) {
      if (legacy[kind] !== all)
        choices.brands[id] = { ...choices.brands[id], [kind]: legacy[kind] };
    }
  }
  return choices;
}

/** Saved rows as choices: kinds a row doesn't name keep their default. */
export function choicesFromRows(rows: NotificationPreferenceRow[]): NotificationChoices {
  const choices = defaultChoices();
  for (const row of rows) {
    if (!isNotificationKind(row.kind) || !fitsKind(row.kind, row.frequency)) continue;
    if (row.delivery === 'combined' || row.delivery === 'per_brand')
      choices.delivery = row.delivery;
    if (row.brand_id === null) {
      choices.all[row.kind] = row.frequency;
    } else if (kindSpec(row.kind).brandScoped) {
      choices.brands[row.brand_id] = { ...choices.brands[row.brand_id], [row.kind]: row.frequency };
    }
  }
  return choices;
}

/** A kind's choice for a brand: the brand's own, else All my brands. */
export function choiceFor(
  choices: NotificationChoices,
  kind: NotificationKind,
  brandId: string | null,
): NotificationFrequency {
  return (brandId && choices.brands[brandId]?.[kind]) || choices.all[kind];
}

/**
 * The rows to save for `choices`, checked: every kind's All my brands row,
 * a brand's row only where it differs and only for `brandIds` (the brands
 * the person may use), Account e-mails only for Admins. Delivery is
 * 'per_brand' until one combined e-mail can be sent.
 */
export function rowsFromChoices(
  choices: NotificationChoices,
  { brandIds, isAdmin }: { brandIds: string[]; isAdmin: boolean },
): NotificationPreferenceRow[] {
  const delivery: NotificationDelivery = 'per_brand';
  const allowed = new Set(brandIds);
  const rows: NotificationPreferenceRow[] = [];
  for (const spec of NOTIFICATION_KIND_SPECS) {
    if (!isAdmin && ADMIN_ONLY_KINDS.includes(spec.kind)) continue;
    const all = choices.all?.[spec.kind];
    const frequency = fitsKind(spec.kind, all) ? all : spec.fallback;
    rows.push({ kind: spec.kind, brand_id: null, frequency, delivery });
    if (!spec.brandScoped) continue;
    for (const [brandId, own] of Object.entries(choices.brands ?? {})) {
      const value = own?.[spec.kind];
      if (!allowed.has(brandId) || !fitsKind(spec.kind, value) || value === frequency) continue;
      rows.push({ kind: spec.kind, brand_id: brandId, frequency: value, delivery });
    }
  }
  return rows;
}
