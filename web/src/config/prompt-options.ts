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
