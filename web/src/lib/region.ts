import { REGIONS } from '@/config/prompt-options';

const REGION_LABELS: ReadonlyMap<string, string> = new Map(
  REGIONS.map((region) => [region.code, region.label]),
);

function normalizeRegionCode(code: string): string {
  return code.trim().toUpperCase();
}

export function regionLabel(code: string): string {
  const normalized = normalizeRegionCode(code);
  return REGION_LABELS.get(normalized) ?? code.trim();
}

export function regionFlag(code: string): string {
  const normalized = normalizeRegionCode(code);
  if (!REGION_LABELS.has(normalized) || !/^[A-Z]{2}$/.test(normalized)) {
    return '';
  }

  const [first, second] = normalized;
  return String.fromCodePoint(
    0x1f1e6 + first.charCodeAt(0) - 65,
    0x1f1e6 + second.charCodeAt(0) - 65,
  );
}

export function formatRegionDisplay(code: string): string {
  const label = regionLabel(code);
  const flag = regionFlag(code);
  return flag ? `${flag} ${label}` : label;
}
