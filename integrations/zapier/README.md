# Ansvisor for Zapier

A Zapier Platform CLI app for receiving Ansvisor webhook events and reading AI visibility metrics.

## Triggers

- **New Daily Pulse** — receives daily_pulse.created.
- **Content Draft Sent** — receives content_draft.sent when a Content Editor page is sent through the brand webhook.
- **New Action Center Task** — receives action_task.sent.
- **Webhook Test Received** — receives webhook.test so a brand's webhook can be tested from Ansvisor settings.

The webhook triggers use Zapier static hooks. Copy the hook URL Zapier gives you into the matching brand's Content → Configure Webhook settings. The app does not create or remove webhook configurations through an Ansvisor subscription API.

Every trigger verifies X-Webhook-Secret using a constant-time comparison. The Content Draft trigger additionally verifies X-Ansvisor-Signature as HMAC-SHA256 over the exact raw request body. Zapier exposes that request as bundle.rawRequest.

Zapier receives the hook request before the app's trigger code runs. The trigger rejects invalid events so they are not passed into the Zap, but Zapier controls the HTTP response from its hook endpoint; the sender is not guaranteed to receive an HTTP 401 for an invalid event.

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
4. For webhook triggers, add the secret configured on the target brand's webhook. Use a separate Zapier connection for each brand because webhook secrets are per brand. The secret is optional when using metrics actions only.

The API key and webhook secret are password fields. The app does not write either value to application logs.

## Development

~~~sh
npm install
npm test
npm run validate
~~~

For local CLI testing, copy .env.example to .env and replace the placeholder values. Never commit .env.

Registering, pushing and submitting the app to the public Zapier directory require access to Ansvisor's Zapier account. A contributor can prepare and validate the app, then hand the submission to a maintainer.
