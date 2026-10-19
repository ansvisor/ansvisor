import type { PromptVolume } from '@/types';

export interface PromptVolumeCluster {
  keyword: string;
  volume: number;
  estimatedAiVolume: number;
  occurrences: number;
  prompts: {
    id: string;
    text: string;
    intent: string;
    volume: number;
    estimatedAiVolume: number;
  }[];
}

export function aggregatePromptVolumeClusters(volumes: PromptVolume[]): PromptVolumeCluster[] {
  const merged = new Map<string, PromptVolumeCluster>();

  for (const v of volumes) {
    for (const kw of v.keywords) {
      const normalized = kw.trim().toLowerCase();
      if (!normalized) continue;

      const volume = v.googleVolumes[kw] ?? 0;
      const estimatedAiVolume = Math.round(volume * v.aiVolumeMultiplier);
      const existing = merged.get(normalized);

      if (existing) {
        existing.volume += volume;
        existing.estimatedAiVolume += estimatedAiVolume;
        existing.occurrences += 1;
        existing.prompts.push({
          id: v.promptId,
          text: v.promptText,
          intent: v.intent,
          volume,
          estimatedAiVolume,
        });
      } else {
        merged.set(normalized, {
          keyword: kw,
          volume,
          estimatedAiVolume,
          occurrences: 1,
          prompts: [
            {
              id: v.promptId,
              text: v.promptText,
              intent: v.intent,
              volume,
              estimatedAiVolume,
            },
          ],
        });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.volume - a.volume);
}
