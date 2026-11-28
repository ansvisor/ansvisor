const { apiRequest } = require('./lib/api');

function includeApiKey(request, z, bundle) {
  const apiKey = bundle && bundle.authData && bundle.authData.api_key;
  if (!apiKey) throw new Error('Connect an Ansvisor API key before using this action.');
  request.headers = request.headers || {};
  request.headers.Authorization = 'Bearer ' + apiKey;
  return request;
}

const authentication = {
  type: 'custom',
  connectionLabel: 'Ansvisor',
  fields: [
    {
      key: 'api_key',
      label: 'Ansvisor API key',
      type: 'password',
      required: true,
      helpText: 'Create a key under Settings → MCP & API Keys. It is shown only once. See https://docs.ansvisor.com/guides/mcp-server for setup details.',
    },
    {
      key: 'base_url',
      label: 'Ansvisor web app URL',
      type: 'string',
      required: false,
      default: 'https://app.ansvisor.com',
      helpText: 'Use https://app.ansvisor.com for Ansvisor Cloud, or your self-hosted web app origin.',
    },
    {
      key: 'webhook_secret',
      label: 'Brand webhook secret',
      type: 'password',
      required: false,
      helpText: 'Optional for API actions. Required for webhook triggers. Use a separate Ansvisor connection for each brand because webhook secrets are per brand.',
    },
  ],
  test: (z, bundle) => apiRequest(z, bundle, 'whoami'),
};

module.exports = { authentication, includeApiKey };
