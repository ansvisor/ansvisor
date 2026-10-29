import { getAIProviderDisplayName, resolveAIProvider } from '@/components/ai-provider-avatar';
import { MODEL_PROVIDER_LABELS, PLATFORM_LABELS } from '@/config/platform-labels';

/**
 * The model filter on Brand Visibility and Citations offers one entry per
 * name the page shows: ChatGPT's web answers and its API model are one
 * "ChatGPT", its value their slugs joined ("chatgpt-web,gpt-5-chat-latest"),
 * which the server reads with .in().
 */

/** The name a model slug is shown by, which groups it with its family. */
export function modelLabel(slug: string): string {
  return (
    MODEL_PROVIDER_LABELS[slug] ??
    PLATFORM_LABELS[slug] ??
    getAIProviderDisplayName(resolveAIProvider(slug))
  );
}

/** The filter's values for the slugs answers came from: each family's slugs, sorted and joined. */
export function modelFamilies(slugs: readonly string[]): string[] {
  const families = new Map<string, string[]>();
  for (const slug of new Set(slugs)) {
    if (!slug) continue;
    const label = modelLabel(slug);
    families.set(label, [...(families.get(label) ?? []), slug]);
  }
  return [...families.values()].map((members) => members.sort().join(',')).sort();
}

/**
 * The filter value an address names, as the dropdown would set it: one slug
 * of a family (Chat's link, "model=chatgpt-web") reads as its whole family,
 * so the numbers are those of picking ChatGPT. Anything else is kept.
 */
export function modelFamilyValue(value: string, families: readonly string[]): string {
  if (!value || families.includes(value)) return value;
  const asked = value.split(',');
  return (
    families.find((family) => {
      const members = family.split(',');
      return asked.every((slug) => members.includes(slug));
    }) ?? value
  );
}

/** Whether a value is a single slug, so it may stand for a family. */
export const isSingleModel = (value: string) => value !== '' && !value.includes(',');
