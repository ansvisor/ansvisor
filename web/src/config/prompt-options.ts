export const REGIONS = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'TR', label: 'Turkey' },
  { code: 'JP', label: 'Japan' },
  { code: 'BR', label: 'Brazil' },
  { code: 'IN', label: 'India' },
  { code: 'AU', label: 'Australia' },
  { code: 'CA', label: 'Canada' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'KR', label: 'South Korea' },
  { code: 'SE', label: 'Sweden' },
  { code: 'MX', label: 'Mexico' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'United Arab Emirates' },
] as const;

export type RegionCode = (typeof REGIONS)[number]['code'];

/**
 * US states for optional state-level geo-targeting (#554). Static on purpose:
 * the UI must not depend on the scraping provider's states endpoint. Codes are
 * USPS two-letter abbreviations, which is what the provider expects alongside
 * `country: 'US'`.
 */
export const US_STATES = [
  { code: 'AL', label: 'Alabama' },
  { code: 'AK', label: 'Alaska' },
  { code: 'AZ', label: 'Arizona' },
  { code: 'AR', label: 'Arkansas' },
  { code: 'CA', label: 'California' },
  { code: 'CO', label: 'Colorado' },
  { code: 'CT', label: 'Connecticut' },
  { code: 'DE', label: 'Delaware' },
  { code: 'DC', label: 'District of Columbia' },
  { code: 'FL', label: 'Florida' },
  { code: 'GA', label: 'Georgia' },
  { code: 'HI', label: 'Hawaii' },
  { code: 'ID', label: 'Idaho' },
  { code: 'IL', label: 'Illinois' },
  { code: 'IN', label: 'Indiana' },
  { code: 'IA', label: 'Iowa' },
  { code: 'KS', label: 'Kansas' },
  { code: 'KY', label: 'Kentucky' },
  { code: 'LA', label: 'Louisiana' },
  { code: 'ME', label: 'Maine' },
  { code: 'MD', label: 'Maryland' },
  { code: 'MA', label: 'Massachusetts' },
  { code: 'MI', label: 'Michigan' },
  { code: 'MN', label: 'Minnesota' },
  { code: 'MS', label: 'Mississippi' },
  { code: 'MO', label: 'Missouri' },
  { code: 'MT', label: 'Montana' },
  { code: 'NE', label: 'Nebraska' },
  { code: 'NV', label: 'Nevada' },
  { code: 'NH', label: 'New Hampshire' },
  { code: 'NJ', label: 'New Jersey' },
  { code: 'NM', label: 'New Mexico' },
  { code: 'NY', label: 'New York' },
  { code: 'NC', label: 'North Carolina' },
  { code: 'ND', label: 'North Dakota' },
  { code: 'OH', label: 'Ohio' },
  { code: 'OK', label: 'Oklahoma' },
  { code: 'OR', label: 'Oregon' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'RI', label: 'Rhode Island' },
  { code: 'SC', label: 'South Carolina' },
  { code: 'SD', label: 'South Dakota' },
  { code: 'TN', label: 'Tennessee' },
  { code: 'TX', label: 'Texas' },
  { code: 'UT', label: 'Utah' },
  { code: 'VT', label: 'Vermont' },
  { code: 'VA', label: 'Virginia' },
  { code: 'WA', label: 'Washington' },
  { code: 'WV', label: 'West Virginia' },
  { code: 'WI', label: 'Wisconsin' },
  { code: 'WY', label: 'Wyoming' },
] as const;

export type UsStateCode = (typeof US_STATES)[number]['code'];

export const LANGUAGES = [
  { code: 'en', label: 'English (en)' },
  { code: 'de', label: 'German (de)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'tr', label: 'Turkish (tr)' },
  { code: 'ja', label: 'Japanese (ja)' },
  { code: 'pt', label: 'Portuguese (pt)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'ko', label: 'Korean (ko)' },
  { code: 'it', label: 'Italian (it)' },
  { code: 'nl', label: 'Dutch (nl)' },
  { code: 'sv', label: 'Swedish (sv)' },
  { code: 'ar', label: 'Arabic (ar)' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const MODEL_GROUPS = [
  {
    provider: 'Claude',
    models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
  },
] as const;

export const ALL_MODELS = MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => ({ ...m, provider: g.provider })),
);

export const SCRAPER_GROUPS = [
  {
    provider: 'Cloro',
    scrapers: [
      { id: 'chatgpt-web', label: 'ChatGPT (Web)', platform: 'chatgpt' },
      { id: 'chatgpt-shopping', label: 'ChatGPT Shopping', platform: 'chatgpt-shopping' },
      { id: 'google-aio', label: 'Google AI Overview', platform: 'google-ai-overviews' },
      { id: 'google-aimode', label: 'Google AI Mode', platform: 'google-ai-mode' },
      { id: 'copilot-web', label: 'Microsoft Copilot', platform: 'copilot' },
      { id: 'grok-web', label: 'Grok', platform: 'grok' },
      { id: 'perplexity-web', label: 'Perplexity', platform: 'perplexity' },
      { id: 'gemini-web', label: 'Google Gemini', platform: 'gemini' },
    ],
  },
] as const;

export const ALL_SCRAPERS = SCRAPER_GROUPS.flatMap((g) =>
  g.scrapers.map((s) => ({ ...s, provider: g.provider })),
);

/**
 * Date-range presets for the Prompts page (#686).
 *
 * No 24h option: a single day gives one or two runs per prompt, so the scores
 * would be noise and most of the table would read zero. No "all time" either —
 * the visibility summaries scan every result row in the window, so an
 * unbounded range has unbounded cost, and 90 days matches the fan-out cap.
 */
export const PROMPT_RANGE_DAYS = [7, 30, 90] as const;

export type PromptRangeDays = (typeof PROMPT_RANGE_DAYS)[number];

export const DEFAULT_PROMPT_RANGE_DAYS: PromptRangeDays = 30;

export function isPromptRangeDays(value: unknown): value is PromptRangeDays {
  return PROMPT_RANGE_DAYS.includes(Number(value) as PromptRangeDays);
}

/**
 * The same windows spoken in the shared date-range control's vocabulary
 * (#713). Derived from the day counts above rather than written out again, so
 * adding a window is still a one-line change in one place.
 *
 * The page's data path takes a day count; the control takes a preset id. These
 * two helpers are the whole translation.
 */
export type PromptRangePreset = `${PromptRangeDays}d`;

export const PROMPT_RANGE_PRESETS = PROMPT_RANGE_DAYS.map(
  (days) => `${days}d`,
) as readonly PromptRangePreset[];

export function promptRangePresetOf(days: PromptRangeDays): PromptRangePreset {
  return `${days}d`;
}

export function promptRangeDaysOf(preset: PromptRangePreset): PromptRangeDays {
  return Number(preset.slice(0, -1)) as PromptRangeDays;
}
