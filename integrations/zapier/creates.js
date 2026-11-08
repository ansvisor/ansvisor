const { apiRequest, requireBrandId } = require('./lib/api');

const brandField = () => ({
  key: 'brand_id',
  label: 'Brand',
  type: 'string',
  required: true,
  dynamic: 'brandList.id.name',
  search: 'findBrand.id',
  helpText: 'Choose a brand available to the connected Ansvisor API key.',
});

const dateFields = () => [
  { key: 'date_from', label: 'Start date', type: 'string', required: false, helpText: 'Optional. Use YYYY-MM-DD.' },
  { key: 'date_to', label: 'End date', type: 'string', required: false, helpText: 'Optional. Use YYYY-MM-DD; the end date is inclusive.' },
];

const visibilitySummary = (z, bundle) => {
  const input = bundle.inputData || {};
  return apiRequest(z, bundle, 'visibility-summary', {
    brand_id: requireBrandId(bundle),
    date_from: input.date_from,
    date_to: input.date_to,
    model: input.model,
    region: input.region,
  });
};

const visibilityTrend = (z, bundle) => {
  const input = bundle.inputData || {};
  return apiRequest(z, bundle, 'visibility-trend', {
    brand_id: requireBrandId(bundle),
    date_from: input.date_from,
    date_to: input.date_to,
    granularity: input.granularity,
    model: input.model,
    region: input.region,
    topic_id: input.topic_id,
  });
};

const citations = (z, bundle) => {
  const input = bundle.inputData || {};
  return apiRequest(z, bundle, 'citations', {
    brand_id: requireBrandId(bundle),
    date_from: input.date_from,
    date_to: input.date_to,
    model: input.model,
    region: input.region,
    topic_id: input.topic_id,
    source_filter: input.source_filter,
    limit: input.limit,
  });
};

const aiTraffic = (z, bundle) => {
  const input = bundle.inputData || {};
  return apiRequest(z, bundle, 'ai-traffic', {
    brand_id: requireBrandId(bundle),
    date_from: input.date_from,
    date_to: input.date_to,
  });
};

const creates = {
  getVisibilitySummary: {
    key: 'get_visibility_summary',
    noun: 'Visibility Summary',
    display: { label: 'Get Visibility Summary', description: 'Returns visibility KPIs and leading competitors for a brand and date range.' },
    operation: {
      perform: visibilitySummary,
      inputFields: [
        brandField(), ...dateFields(),
        { key: 'model', label: 'AI model filter', type: 'string', required: false, helpText: 'Optional comma-separated model slugs.' },
        { key: 'region', label: 'Region filter', type: 'string', required: false },
      ],
      sample: { brand_id: 'brand-123', totals: { aiVisibilityScore: 42.5, totalMentions: 31, totalCitations: 12 }, topCompetitors: [] },
    },
  },
  getVisibilityTrend: {
    key: 'get_visibility_trend',
    noun: 'Visibility Trend',
    display: { label: 'Get Visibility Trend', description: 'Returns daily or weekly visibility buckets for a brand.' },
    operation: {
      perform: visibilityTrend,
      inputFields: [
        brandField(), ...dateFields(),
        { key: 'granularity', label: 'Granularity', type: 'string', required: false, choices: ['day', 'week'], default: 'day' },
        { key: 'model', label: 'AI model filter', type: 'string', required: false, helpText: 'Optional comma-separated model slugs.' },
        { key: 'region', label: 'Region filter', type: 'string', required: false },
        { key: 'topic_id', label: 'Topic ID', type: 'string', required: false },
      ],
      sample: { granularity: 'day', buckets: [{ date: '2026-11-01', ai_visibility_score: 42.5, total_mentions: 31, total_citations: 12 }] },
    },
  },
  getCitations: {
    key: 'get_citations',
    noun: 'Citations',
    display: { label: 'Get Citations', description: 'Returns citation totals, source breakdowns, top domains and top URLs.' },
    operation: {
      perform: citations,
      inputFields: [
        brandField(), ...dateFields(),
        { key: 'source_filter', label: 'Source filter', type: 'string', required: false, choices: ['all', 'owned', 'competitor', 'external'], default: 'all' },
        { key: 'limit', label: 'Top list limit', type: 'integer', required: false, default: 50, helpText: 'Between 1 and 200.' },
        { key: 'model', label: 'AI model filter', type: 'string', required: false, helpText: 'Optional comma-separated model slugs.' },
        { key: 'region', label: 'Region filter', type: 'string', required: false },
        { key: 'topic_id', label: 'Topic ID', type: 'string', required: false },
      ],
      sample: { totals: { citations: 12 }, source_breakdown: [], top_domains: [], top_urls: [] },
    },
  },
  getAiTraffic: {
    key: 'get_ai_traffic',
    noun: 'AI Traffic',
    display: { label: 'Get AI Traffic', description: 'Returns AI-referred visits and platform, page and country breakdowns.' },
    operation: {
      perform: aiTraffic,
      inputFields: [brandField(), ...dateFields()],
      sample: { tracking: 'active', total_visits: 12, platform_breakdown: [], top_pages: [], country_breakdown: [] },
    },
  },
};

module.exports = { visibilitySummary, visibilityTrend, citations, aiTraffic, creates };
