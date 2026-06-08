# Ansvisor Server

The Ansvisor backend service. This is an Express API accompanied by background workers that handle tracking, data volumes, content generation, and the traffic tracking pixel.

## Prerequisites & Setup

- Node.js (v18+)
- Yarn or npm

Create your environment file by copying the example:

```bash
cp .env.example .env
```

### Environment Variables

The `.env` file requires several keys to function correctly. Reference `.env.example` for the full list, but the main groups are:
- **Supabase**: Connection strings and anon keys.
- **AI Providers**: API keys for OpenAI, Anthropic, Gemini, etc.
- **Scrapers**: Credentials for DataForSEO and the Cloro webhook secret.
- **Payments**: Stripe keys.
- **Security**: CORS origins and `IS_CLOUD` mode flag.

## Running the Service

For local development (uses `nodemon`):
```bash
yarn dev
# or
npm run dev
```

For production (uses `pm2`):
```bash
yarn start
# or
npm start
```

## Route Summary

The API routes are mounted across two main files (`src/routes/index.js` and `src/server.js`):

- `GET /` — Basic service status
- `GET /api/health` — Detailed health check
- `/api/*` — Authenticated endpoints for `prompts`, `tracking`, `volumes`, `content`, `competitors`, and `topics`
- `/api/internal/*` — Internal job triggers (daily-tracking, content brief, trigger-tracking)
- `/cloro/callback` — Webhook callback for the scraper service
- Traffic pixel routes are mounted directly at the root `/`
