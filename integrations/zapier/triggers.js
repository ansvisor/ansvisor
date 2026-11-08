const { createWebhookPerform } = require('./lib/webhook');
const { createSubscribe, unsubscribe } = require('./lib/subscription');
const { listBrands } = require('./searches');

const brandField = {
  key: 'brand_id',
  label: 'Brand',
  type: 'string',
  required: true,
  dynamic: 'brand_list.id.name',
  search: 'find_brand.id',
  helpText: 'Choose a brand available to the connected Ansvisor API key.',
};

function webhookTrigger(key, noun, label, description, event, sample) {
  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      inputFields: [brandField],
      perform: createWebhookPerform(event),
      performSubscribe: createSubscribe(event),
      performUnsubscribe: unsubscribe,
      sample,
    },
  };
}

module.exports = {
  brand_list: {
    key: 'brand_list',
    noun: 'Brand',
    display: {
      label: 'Brand list',
      description: 'Lists brands available to the connected Ansvisor API key.',
      hidden: true,
    },
    operation: {
      perform: listBrands,
      sample: { id: 'brand-123', name: 'Acme', slug: 'acme' },
    },
  },
  new_daily_pulse: webhookTrigger(
    'new_daily_pulse',
    'Daily Pulse',
    'New Daily Pulse',
    'Triggers when Ansvisor creates a Daily Pulse for a brand.',
    'daily_pulse.created',
    {
      id: 'brand-123:2026-11-08',
      event: 'daily_pulse.created',
      brand: { id: 'brand-123', name: 'Acme' },
      pulse: { date: '2026-11-08', frequency: 'daily', kpis: { visibilityRate: 42.5, citations: 12 } },
    },
  ),
  new_content_draft: webhookTrigger(
    'new_content_draft',
    'Content Draft',
    'Content Draft Sent',
    'Triggers when a Content Editor page is sent through the brand webhook.',
    'content_draft.sent',
    {
      id: 'delivery-123',
      event: 'content_draft.sent',
      schemaVersion: 1,
      delivery: { id: 'delivery-123', batchId: null, sentAt: '2026-11-08T10:00:00.000Z' },
      page: { draftId: 'draft-123', title: 'A practical guide', slug: 'practical-guide', html: '<p>Example content</p>' },
      brand: { id: 'brand-123', name: 'Acme', domain: 'acme.example' },
    },
  ),
  new_action_task: webhookTrigger(
    'new_action_task',
    'Action Center Task',
    'New Action Center Task',
    'Triggers when a user sends an Action Center task to the brand webhook.',
    'action_task.sent',
    {
      id: 'task-123',
      event: 'action_task.sent',
      task: { id: 'task-123', title: 'Update the shipping guide', status: 'todo', type: 'content' },
      action: { id: 'action-123', action_no: 12, kind: 'recover_lost_citations', impact: 'high' },
      brand: { name: 'Acme', domain: 'acme.example', industry: 'Software' },
    },
  ),
};
