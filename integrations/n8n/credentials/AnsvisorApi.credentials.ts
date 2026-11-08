import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
  Icon,
} from 'n8n-workflow';

export class AnsvisorApi implements ICredentialType {
  name = 'ansvisorApi';

  displayName = 'Ansvisor API';

  icon: Icon = {
    light: 'file:../icons/ansvisor.svg',
    dark: 'file:../icons/ansvisor.dark.svg',
  };

  documentationUrl = 'https://github.com/ansvisor/ansvisor/blob/main/docs/api-reference/metrics.mdx';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'An Ansvisor API key beginning with ans_.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://app.ansvisor.com',
      required: true,
      description: 'The origin of your Ansvisor web app. Change this for self-hosted installations.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/whoami',
      method: 'GET',
    },
  };
}
