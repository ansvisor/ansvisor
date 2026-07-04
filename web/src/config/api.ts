export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:80';

export function getPublicApiBaseUrl(): string {
  const isCloud = process.env.NEXT_PUBLIC_IS_CLOUD === 'true';

  return isCloud ? 'https://api.optumusanalytics.com' : (process.env.NEXT_PUBLIC_API_URL ?? '');
}
