import express, { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supabaseAdmin from '../config/supabase.js';
import { trafficLimiter } from '../middleware/rate-limiter.js';
import logger from '../lib/logger.js';

const router = Router();

// Beacons are sent as text/plain so navigator.sendBeacon stays a CORS-safelisted
// request — application/json would require a preflight, which beacons can't do,
// so the browser silently blocks them. Read the body as text here; the handler
// JSON-parses it. application/json is still accepted (older cached t.js, direct
// API callers): the global json parser handles those and this middleware no-ops
// once a body has already been parsed.
const beaconBody = express.text({ type: ['text/plain', 'application/json'], limit: '64kb' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, '..', 'public', 't.js');

let cachedScript = null;
let cachedEtag = null;

function getScript() {
  if (!cachedScript) {
    cachedScript = readFileSync(scriptPath, 'utf-8');
    cachedEtag = `"${Buffer.from(cachedScript).length.toString(36)}-${Date.now().toString(36)}"`;
  }
  return { body: cachedScript, etag: cachedEtag };
}

/**
 * GET /t.js — serve the tracking script with aggressive caching
 */
router.get('/t.js', (req, res) => {
  const { body, etag } = getScript();

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });

  return res.send(body);
});

/**
 * CORS preflight for track endpoint (fetch fallback needs this)
 */
router.options('/track/:trackingCode', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  return res.status(204).end();
});

/**
 * POST /track/:trackingCode — receive beacon data from t.js
 */
router.post('/track/:trackingCode', trafficLimiter, beaconBody, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const { trackingCode } = req.params;

    if (!trackingCode || trackingCode.length < 6 || trackingCode.length > 64) {
      return res.status(400).json({ ok: false });
    }

    const { data: brand, error: brandErr } = await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('tracking_code', trackingCode)
      .single();

    if (brandErr || !brand) {
      return res.status(404).json({ ok: false });
    }

    // Body arrives as a JSON string (text/plain beacon) or an already-parsed
    // object (application/json via the global json parser). Normalize both.
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false });
      }
    }
    if (!body || !body.u) {
      return res.status(400).json({ ok: false });
    }

    const ip =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.ip;

    const country = req.headers['cf-ipcountry'] || null;

    // Only persist platform-attributable visits (#288). t.js already resolves a
    // concrete platform (AI referrer host or a known utm_source) and returns
    // early otherwise — but older cached snippets still send an empty platform
    // for utm-detected visits, which previously stored a null "Unknown" row.
    // Drop those defensively so the data has no unattributable rows. The body is
    // untrusted: only accept a string, and trim so whitespace-only values can't
    // slip past the emptiness check (a non-string can't reach .slice and crash).
    const sourcePlatform = (typeof body.s === 'string' ? body.s : '').trim().slice(0, 255);
    if (!sourcePlatform) {
      return res.status(204).end();
    }

    await supabaseAdmin.from('ai_traffic_logs').insert({
      brand_id: brand.id,
      url: (body.u || '').slice(0, 2048),
      referrer: (body.r || '').slice(0, 2048) || null,
      source_platform: sourcePlatform,
      user_agent: (body.a || '').slice(0, 512) || null,
      ip_address: ip || null,
      country,
      language: (body.l || '').slice(0, 16) || null,
      screen: (body.d || '').slice(0, 16) || null,
    });

    return res.status(204).end();
  } catch (error) {
    // Module logger, not req.log: trafficRoutes is mounted before
    // requestIdMiddleware in server.js (it needs its own open CORS), so
    // req.log is undefined on this public beacon path.
    logger.error({ err: error }, 'traffic track error');
    return res.status(500).json({ ok: false });
  }
});

export default router;
