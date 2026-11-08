import { describe, expect, it } from 'vitest';
import {
  buildAnsvisorApiRequest,
  buildAnsvisorHttpRequest,
} from './apiRequest';

describe('buildAnsvisorApiRequest', () => {
  it('lists brands without a brand filter', () => {
    expect(buildAnsvisorApiRequest('brand', 'getAll', {})).toEqual({
      path: '/api/v1/brands',
      qs: {},
    });
  });

  it('builds a visibility summary request with the documented query names', () => {
    expect(
      buildAnsvisorApiRequest('visibility', 'getSummary', {
        brandId: 'brand-123',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      }),
    ).toEqual({
      path: '/api/v1/visibility-summary',
      qs: {
        brand_id: 'brand-123',
        date_from: '2026-10-01',
        date_to: '2026-10-31',
      },
    });
  });

  it('defaults visibility trends to daily buckets', () => {
    expect(
      buildAnsvisorApiRequest('visibility', 'getTrend', { brandId: 'brand-123' }),
    ).toEqual({
      path: '/api/v1/visibility-trend',
      qs: { brand_id: 'brand-123', granularity: 'day' },
    });
  });

  it('passes citation filters and limits through', () => {
    expect(
      buildAnsvisorApiRequest('citation', 'get', {
        brandId: 'brand-123',
        sourceFilter: 'external',
        limit: 25,
      }),
    ).toEqual({
      path: '/api/v1/citations',
      qs: { brand_id: 'brand-123', source_filter: 'external', limit: 25 },
    });
  });

  it('builds AI traffic requests', () => {
    expect(buildAnsvisorApiRequest('aiTraffic', 'get', { brandId: 'brand-123' })).toEqual({
      path: '/api/v1/ai-traffic',
      qs: { brand_id: 'brand-123' },
    });
  });

  it('requires a brand for metrics endpoints', () => {
    expect(() => buildAnsvisorApiRequest('citations', 'get', {})).toThrow(
      'A brand is required',
    );
  });

  it('rejects undocumented operations', () => {
    expect(() => buildAnsvisorApiRequest('brand', 'get', {})).toThrow(
      'not supported',
    );
  });
});

describe('buildAnsvisorHttpRequest', () => {
  it('creates an authenticated GET request target without a trailing base URL slash', () => {
    expect(
      buildAnsvisorHttpRequest('https://self-hosted.example/', {
        path: '/api/v1/brands',
        qs: {},
      }),
    ).toEqual({
      method: 'GET',
      url: 'https://self-hosted.example/api/v1/brands',
      qs: {},
      json: true,
    });
  });
});
