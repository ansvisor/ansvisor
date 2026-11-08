# Ansvisor for Zapier

A Zapier Platform CLI app for receiving Ansvisor webhook events and reading AI visibility metrics.

## Triggers

- **New Daily Pulse** — receives daily_pulse.created.
- **Content Draft Sent** — receives content_draft.sent when a Content Editor page is sent through the brand webhook.
- **New Action Center Task** — receives action_task.sent.

Each trigger is a REST Hook. When a Zap is enabled, the app registers an event-specific webhook config with Ansvisor using the selected brand, Zapier target URL and brand secret. When the Zap is disabled or removed, the app deletes only that Zapier-managed config. The dashboard's Default webhook config remains separate.

Ansvisor also sends webhook.test to every active webhook config, regardless of its event filter. Each event trigger accepts this test delivery so users can test the connection from Ansvisor settings.

Every event verifies X-Webhook-Secret using a constant-time comparison. The content_draft.sent event additionally verifies X-Ansvisor-Signature as HMAC-SHA256 over the exact raw request body exposed by Zapier as bundle.rawRequest.

## Searches and actions

- **Find Brand** — searches the brands returned by the API key.
- **Get Visibility Summary** — GET /api/v1/visibility-summary.
- **Get Visibility Trend** — GET /api/v1/visibility-trend.
- **Get Citations** — GET /api/v1/citations.
- **Get AI Traffic** — GET /api/v1/ai-traffic.

All metrics operations are read-only. Brand data is limited by the organization available to the connected API key.

## Connect Ansvisor

1. In Ansvisor, open **Settings → MCP & API Keys** and create an API key.
2. In Zapier, connect an Ansvisor account and paste the ans_ key.
3. Keep the base URL as https://app.ansvisor.com, or enter your self-hosted web app URL.
4. For webhook triggers, add the secret configured for the target brand. Use a separate Zapier connection for each brand because webhook secrets are per brand. The secret is optional when using metrics actions only.
5. The API key's user must be an admin or manager with webhook write access to create or remove subscriptions.

The API key and webhook secret are password fields. The app does not write either value to application logs.

## Development

~~~sh
npm install
npm test
npm run validate
~~~

For local CLI testing, copy .env.example to .env and replace the placeholder values. Never commit .env.

Registering, pushing and submitting the app to the public Zapier directory require access to the Ansvisor Zapier account. A contributor can prepare and validate the app, then hand the submission to a maintainer.
