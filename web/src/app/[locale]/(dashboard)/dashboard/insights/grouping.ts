import type { PromptResultWithText } from '@/lib/actions/tracking';

export interface PlatformGroup {
  key: string;
  platform: string;
  modelUsed?: string;
  region?: string;
  results: PromptResultWithText[];
  latest: PromptResultWithText;
  latestScore: number;
  avgScore: number;
  totalMentions: number;
  totalCitations: number;
}

export interface PromptGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  results: PromptResultWithText[];
  platformGroups: PlatformGroup[];
  avgScore: number;
  totalMentions: number;
  totalCitations: number;
}

export interface TopicGroup {
  topicId: string;
  topicName: string;
  prompts: PromptGroup[];
  avgScore: number;
  totalMentions: number;
  totalCitations: number;
  totalResults: number;
}

export function groupResultsByPlatform(items: PromptResultWithText[]): PlatformGroup[] {
  const map = new Map<string, PromptResultWithText[]>();
  for (const r of items) {
    const key = r.platform;
    const arr = map.get(key) || [];
    arr.push(r);
    map.set(key, arr);
  }

  return Array.from(map.entries())
    .map(([key, arr]) => {
      const sorted = [...arr].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const latest = sorted[0];
      return {
        key,
        platform: latest.platform,
        modelUsed: latest.modelUsed,
        region: latest.region,
        results: sorted,
        latest,
        latestScore: latest.visibilityScore,
        avgScore:
          Math.round((sorted.reduce((s, r) => s + r.visibilityScore, 0) / sorted.length) * 10) / 10,
        totalMentions: sorted.reduce((s, r) => s + r.mentionCount, 0),
        totalCitations: sorted.reduce((s, r) => s + r.citationCount, 0),
      } satisfies PlatformGroup;
    })
    .sort((a, b) => b.latestScore - a.latestScore);
}

function computePromptGroup(promptId: string, items: PromptResultWithText[]): PromptGroup {
  const sorted = [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return {
    promptId,
    promptText: sorted[0].promptText,
    promptCategory: sorted[0].promptCategory,
    results: sorted,
    platformGroups: groupResultsByPlatform(sorted),
    avgScore: Math.round(sorted.reduce((s, r) => s + r.visibilityScore, 0) / sorted.length),
    totalMentions: sorted.reduce((s, r) => s + r.mentionCount, 0),
    totalCitations: sorted.reduce((s, r) => s + r.citationCount, 0),
  };
}

export function groupResultsByTopic(results: PromptResultWithText[]): TopicGroup[] {
  const topicMap = new Map<string, PromptResultWithText[]>();
  for (const r of results) {
    const key = r.topicName ?? '__uncategorized__';
    const arr = topicMap.get(key) || [];
    arr.push(r);
    topicMap.set(key, arr);
  }

  return Array.from(topicMap.entries())
    .map(([topicName, items]) => {
      const promptMap = new Map<string, PromptResultWithText[]>();
      for (const r of items) {
        const arr = promptMap.get(r.promptId) || [];
        arr.push(r);
        promptMap.set(r.promptId, arr);
      }
      const prompts = Array.from(promptMap.entries()).map(([pid, pItems]) =>
        computePromptGroup(pid, pItems),
      );
      return {
        topicId: items[0].topicId ?? `__cat_${topicName}`,
        topicName: topicName === '__uncategorized__' ? 'Uncategorized' : topicName,
        prompts,
        avgScore: Math.round(items.reduce((s, r) => s + r.visibilityScore, 0) / items.length),
        totalMentions: items.reduce((s, r) => s + r.mentionCount, 0),
        totalCitations: items.reduce((s, r) => s + r.citationCount, 0),
        totalResults: items.length,
      } satisfies TopicGroup;
    })
    .sort((a, b) => b.avgScore - a.avgScore);
}
