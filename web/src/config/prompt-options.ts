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
