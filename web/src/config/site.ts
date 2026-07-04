export const siteConfig = {
  name: 'Optumus Analytics',
  description:
    "Track visibility across ChatGPT, Claude, Gemini, Google AI, Perplexity, Grok, Copilot and more.",
  url: 'https://optumusanalytics.com',
  ogImage: 'https://optumusanalytics.com/opengraph-image',
  links: {
    github: 'https://github.com/optumus/optumus-analytics',
    docs: 'https://docs.optumusanalytics.com',
  },
  legal: {
    privacy: 'https://optumusanalytics.com/privacy-policy',
    terms: 'https://optumusanalytics.com/terms-of-service',
  },
} as const;

export type SiteConfig = typeof siteConfig;
