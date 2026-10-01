export const siteConfig = {
  name: 'Ansvisor',
  description:
    "Monitor, analyze, and optimize your brand's visibility in AI-powered search engines like ChatGPT, Perplexity, Gemini, and more.",
  url: 'https://ansvisor.com',
  ogImage: 'https://app.ansvisor.com/opengraph-image',
  links: {
    github: 'https://github.com/ansvisor/ansvisor',
    docs: 'https://docs.ansvisor.com',
    feedback: 'https://www.ansvisor.com/feedback',
  },
  legal: {
    privacy: 'https://www.ansvisor.com/privacy-policy',
    terms: 'https://www.ansvisor.com/terms-of-service',
  },
} as const;

export type SiteConfig = typeof siteConfig;
