import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AnsvisorWebhookSecret implements ICredentialType {
  name = 'ansvisorWebhookSecret';

  displayName = 'Ansvisor Webhook Secret';

  documentationUrl = 'https://github.com/ansvisor/ansvisor/blob/main/docs/api-reference/webhooks.mdx';

  properties: INodeProperties[] = [
    {
      displayName: 'Webhook Secret',
      name: 'webhookSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'The secret configured for this brand under Content → Configure Webhook.',
    },
  ];
}
