import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class AnsvisorWebhookSecretApi implements ICredentialType {
  name = 'ansvisorWebhookSecretApi';

  displayName = 'Ansvisor Webhook Secret API';

  icon: Icon = {
    light: 'file:../icons/ansvisor.svg',
    dark: 'file:../icons/ansvisor.dark.svg',
  };

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
