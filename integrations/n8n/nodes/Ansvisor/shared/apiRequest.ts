export type AnsvisorResource = 'brand' | 'visibility' | 'citations' | 'aiTraffic';
export type AnsvisorOperation = 'getAll' | 'getSummary' | 'getTrend' | 'get';

export interface AnsvisorRequestParameters {
  brandId?: string;
  dateFrom?: string;
  dateTo?: string;
  granularity?: 'day' | 'week';
  sourceFilter?: 'all' | 'owned' | 'competitor' | 'external';
  limit?: number;
}

export interface AnsvisorApiRequest {
  path: string;
  qs: Record<string, string | number>;
}

/** Build only the documented, read-only Metrics API requests. */
export function buildAnsvisorApiRequest(
  resource: AnsvisorResource,
  operation: AnsvisorOperation,
  parameters: AnsvisorRequestParameters,
): AnsvisorApiRequest {
  if (resource === 'brand' && operation === 'getAll') {
    return { path: '/api/v1/brands', qs: {} };
  }

  if (!parameters.brandId) {
    throw new Error('A brand is required for this metrics endpoint.');
  }

  const qs: Record<string, string | number> = { brand_id: parameters.brandId };
  if (parameters.dateFrom) qs.date_from = parameters.dateFrom;
  if (parameters.dateTo) qs.date_to = parameters.dateTo;

  if (resource === 'visibility' && operation === 'getSummary') {
    return { path: '/api/v1/visibility-summary', qs };
  }

  if (resource === 'visibility' && operation === 'getTrend') {
    qs.granularity = parameters.granularity ?? 'day';
    return { path: '/api/v1/visibility-trend', qs };
  }

  if (resource === 'citations' && operation === 'get') {
    if (parameters.sourceFilter) qs.source_filter = parameters.sourceFilter;
    if (parameters.limit !== undefined) qs.limit = parameters.limit;
    return { path: '/api/v1/citations', qs };
  }

  if (resource === 'aiTraffic' && operation === 'get') {
    return { path: '/api/v1/ai-traffic', qs };
  }

  throw new Error('The selected Ansvisor resource and operation are not supported.');
}
