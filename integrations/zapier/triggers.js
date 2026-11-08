const { createWebhookPerform } = require('./lib/webhook');
const { listBrands } = require('./searches');

function webhookTrigger(key, label, description, event, sample) {
  return {
    key,
    noun: label,
    display: {
      label,
      description,
      directions: 'Copy the Zapier hook URL into this brand’s Content → Configure Webhook settings, then select this event.',
    },
    operation: {
      type: 'hook',
      perform: createWebhookPerform(event),
      sample,
    },
  };
}

module.exports = {
  brandList: {
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
  newDailyPulse: webhookTrigger(
    'new_daily_pulse',
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
  newContentDraft: webhookTrigger(
    'new_content_draft',
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
  newActionTask: webhookTrigger(
    'new_action_task',
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
  webhookTest: webhookTrigger(
    'webhook_test',
    'Webhook Test Received',
    'Receives the test event sent from Ansvisor webhook settings.',
    'webhook.test',
    {
      id: 'test-event-123',
      event: 'webhook.test',
      message: 'This is a test webhook from AEO platform.',
      timestamp: '2026-07-30T10:00:00.000Z',
    },
  ),
};
