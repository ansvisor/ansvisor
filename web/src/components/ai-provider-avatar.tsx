import { cn } from '@/lib/utils';

export type AIProviderKey =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'googleAio'
  | 'googleAiMode'
  | 'perplexity'
  | 'copilot'
  | 'xai'
  | 'meta';

const AI_PROVIDER_META: Record<
  AIProviderKey,
  { label: string; shortLabel: string; icon: string; fallbackClassName: string }
> = {
  openai: {
    label: 'ChatGPT',
    shortLabel: 'O',
    icon: '/chatgpt.svg',
    fallbackClassName: 'bg-emerald-500 text-white',
  },
  anthropic: {
    label: 'Claude',
    shortLabel: 'A',
    icon: '/claude.svg',
    fallbackClassName: 'bg-amber-500 text-white',
  },
  google: {
    label: 'Gemini',
    shortLabel: 'G',
    icon: '/gemini.svg',
    fallbackClassName: 'bg-blue-500 text-white',
  },
  googleAio: {
    label: 'Google AI Overview',
    shortLabel: 'G',
    icon: '/ai_overview.svg',
    fallbackClassName: 'bg-blue-500 text-white',
  },
  googleAiMode: {
    label: 'Google AI Mode',
    shortLabel: 'G',
    icon: '/ai_mode.svg',
    fallbackClassName: 'bg-blue-500 text-white',
  },
  perplexity: {
    label: 'Perplexity',
    shortLabel: 'P',
    icon: '/perplexity.svg',
    fallbackClassName: 'bg-indigo-500 text-white',
  },
  copilot: {
    label: 'Microsoft Copilot',
    shortLabel: 'C',
    icon: '/copilot.svg',
    fallbackClassName: 'bg-cyan-600 text-white',
  },
  xai: {
    label: 'Grok',
    shortLabel: 'X',
    icon: '/grok.svg',
    fallbackClassName: 'bg-zinc-800 text-white dark:bg-zinc-300 dark:text-zinc-900',
  },
  meta: {
    label: 'Meta AI',
    shortLabel: 'M',
    icon: '',
    fallbackClassName: 'bg-sky-500 text-white',
  },
};

export function resolveAIProvider(model: string, platform?: string): AIProviderKey {
  const key = platform || model;

  if (key === 'ChatGPT' || key === 'chatgpt' || key === 'chatgpt-web' || key.startsWith('gpt-')) {
    return 'openai';
  }
  if (key === 'Claude' || key === 'claude' || key.startsWith('claude-')) {
    return 'anthropic';
  }
  if (
    key === 'Perplexity' ||
    key === 'perplexity' ||
    key === 'perplexity-web' ||
    key.startsWith('sonar')
  ) {
    return 'perplexity';
  }
  if (
    key === 'Microsoft Copilot' ||
    key === 'Copilot' ||
    key === 'copilot' ||
    key === 'copilot-web'
  ) {
    return 'copilot';
  }
  if (key === 'Grok' || key === 'grok' || key === 'grok-web' || key.startsWith('grok-')) {
    return 'xai';
  }
  if (key === 'Google AI Overview' || key === 'google-aio' || key === 'google-ai-overviews') {
    return 'googleAio';
  }
  if (
    key === 'Google AI Mode' ||
    key === 'google-ai-mode' ||
    key === 'google-aimode' ||
    key === 'ai-mode'
  ) {
    return 'googleAiMode';
  }
  if (
    key === 'Gemini' ||
    key === 'Google Gemini' ||
    key === 'gemini' ||
    key === 'gemini-web' ||
    key.startsWith('gemini-')
  ) {
    return 'google';
  }
  if (key === 'Meta AI' || key === 'meta-ai' || key.startsWith('llama-')) {
    return 'meta';
  }

  return platform ? resolveAIProvider(platform) : 'openai';
}

export function getAIProviderDisplayName(provider: AIProviderKey): string {
  return AI_PROVIDER_META[provider].label;
}

export function AIProviderAvatar({
  provider,
  className,
}: {
  provider: AIProviderKey;
  className?: string;
}) {
  const meta = AI_PROVIDER_META[provider];

  if (!meta.icon) {
    return (
      <span
        title={meta.label}
        aria-label={meta.label}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          meta.fallbackClassName,
          className,
        )}
      >
        {meta.shortLabel}
      </span>
    );
  }

  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={cn(
        'relative flex h-5 w-5 shrink-0 overflow-hidden rounded-full border',
        provider === 'openai' ? 'bg-black dark:bg-background' : 'bg-background',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- AI provider favicon URLs come from arbitrary remote domains; next/image remotePatterns would need an open-ended wildcard */}
      <img src={meta.icon} alt="" className="h-full w-full object-cover" aria-hidden="true" />
    </span>
  );
}
