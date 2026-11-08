# n8n-nodes-ansvisor

Community nodes for connecting n8n workflows to [Ansvisor](https://ansvisor.com).

## Nodes

- **Ansvisor Trigger** receives Ansvisor brand webhooks. It checks the configured `X-Webhook-Secret` with a constant-time comparison. For `content_draft.sent`, it also verifies the `X-Ansvisor-Signature` HMAC-SHA256 over the exact raw request body.
- **Ansvisor** reads brands, visibility summaries and trends, citations, and AI traffic from the read-only Metrics API.

The API node only exposes the documented GET endpoints. It does not create or modify Ansvisor data.

## Installation

Once the package is published, install `n8n-nodes-ansvisor` from **Settings → Community Nodes**. Until then, install the package from this directory in a local n8n custom-node setup.

## Credentials

Create an **Ansvisor API** credential with an API key from **Settings → MCP & API Keys**. The key is stored by n8n as a password field and sent only in the Authorization header. Set Base URL to your web app origin; the default is `https://app.ansvisor.com`.

Create an **Ansvisor Webhook Secret** credential with the secret configured for one brand under **Content → Configure Webhook**. Use a separate trigger node and credential for each brand. The secret is not included in trigger output.

## Development

```sh
npm install
npm test
npm run build
npm run lint
```

See [the integration guide](../../docs/guides/n8n.mdx) for setup details.
