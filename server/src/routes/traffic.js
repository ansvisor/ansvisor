import express, { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { trafficLimiter } from '../middleware/rate-limiter.js';
import logger from '../lib/logger.js';
import { findVisitOf } from '../lib/traffic-visits.js';
import { visitorKey as anonymousVisitorKey } from '../lib/visitor-key.js';
import {
  AI_SOURCES_VERSION,
  classifyAiSource,
  classifyAiSurface,
  landingMedium,
} from '../lib/ai-sources.js';
import { buildTrackingScript } from '../lib/tracking-script.js';

const router = Router();

// Beacons are sent as text/plain so navigator.sendBeacon stays a CORS-safelisted
// request — application/json would require a preflight, which beacons can't do,
// so the browser silently blocks them. Read the body as text here; the handler
// JSON-parses it. application/json is still accepted (older cached t.js, direct
// API callers): the global json parser handles those and this middleware no-ops
// once a body has already been parsed.
const beaconBody = express.text({ type: ['text/plain', 'application/json'], limit: '64kb' });

let cachedScript = null;
let cachedEtag = null;

// Built once from the AI source list (AT-004); a list change ships with a
// deploy, which restarts the server and changes the ETag.
function getScript() {
  if (!cachedScript) {
    cachedScript = buildTrackingScript();
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
    const rawPlatform = (typeof body.s === 'string' ? body.s : '').trim().slice(0, 255);
    if (!rawPlatform) {
      return res.status(204).end();
    }
    // Stored under the AI source list's key (AT-004): an older cached t.js
    // still sends the host it matched, like chat.openai.com for ChatGPT.
    const sourcePlatform = classifyAiSource(rawPlatform) ?? rawPlatform;
    const url = (body.u || '').slice(0, 2048);
    // A visit through one of the source's surfaces, like a ChatGPT Shopping
    // product card (utm_medium=feed, #1283), read here from the landing URL
    // as stored, so a cached older snippet's visits are marked too. It stays
    // the source's visit.
    const sourceSurface = classifyAiSurface(sourcePlatform, landingMedium(url));
    // The list version that counted the visit; older snippets don't send one.
    const sourceListVersion =
      Number.isInteger(body.v) && body.v >= 1 && body.v <= AI_SOURCES_VERSION ? body.v : null;

    // The landing page's HTTP status as the browser saw it, for Broken AI
    // links (AT-012). Without one (Safari, older snippets), whether the
    // page's title said "not found".
    const httpStatus =
      Number.isInteger(body.st) && body.st >= 100 && body.st <= 599 ? body.st : null;
    // The title counts without a status, or with a 2xx: a soft 404 (00200).
    const notFoundTitle =
      body.nf === 1 && (httpStatus === null || (httpStatus >= 200 && httpStatus < 300));

    const userAgent = (body.a || '').slice(0, 512) || null;
    // The IP address itself is never stored (GDPR): only a key that tells
    // one visitor's pageviews from another's today (visitor-key.js). If the
    // key can't be made, the pageview is stored as a visit of its own.
    let visitorKey = null;
    try {
      visitorKey = await anonymousVisitorKey({ brandId: brand.id, ip });
    } catch (err) {
      logger.warn({ err }, 'traffic visitor key failed; stored without one');
    }

    // The snippet's second word on a visit it just sent: a single-page app's
    // title read not found only after load (00200). It marks that pageview
    // (the same address, visitor and browser in the last minutes, with no
    // status or a 2xx) rather than counting another visit.
    if (body.k === 'nf') {
      if (httpStatus !== null && (httpStatus < 200 || httpStatus > 299)) {
        return res.status(204).end();
      }
      await markNotFoundTitle({
        brandId: brand.id,
        url,
        visitorKey,
        userAgent,
        httpStatus,
      });
      return res.status(204).end();
    }

    // A reload or a second link from the same answer continues the visit
    // rather than counting as another (AT-003). If the lookup fails the
    // pageview is still stored, as a visit of its own.
    let visitOf = null;
    try {
      visitOf = await findVisitOf({ brandId: brand.id, sourcePlatform, visitorKey, userAgent });
    } catch (err) {
      logger.warn({ err }, 'traffic visit lookup failed; stored as a new visit');
    }

    const { error: insertError } = await supabaseAdmin.from('ai_traffic_logs').insert({
      brand_id: brand.id,
      url,
      referrer: (body.r || '').slice(0, 2048) || null,
      source_platform: sourcePlatform,
      source_surface: sourceSurface,
      user_agent: userAgent,
      visitor_key: visitorKey,
      country,
      language: (body.l || '').slice(0, 16) || null,
      screen: (body.d || '').slice(0, 16) || null,
      visit_of: visitOf,
      source_list_version: sourceListVersion,
      http_status: httpStatus,
      not_found_title: notFoundTitle,
    });
    // The beacon can't be retried, so a failed write is at least visible.
    if (insertError) logger.error({ err: insertError }, 'traffic track insert failed');

    return res.status(204).end();
  } catch (error) {
    // Module logger, not req.log: trafficRoutes is mounted before
    // requestIdMiddleware in server.js (it needs its own open CORS), so
    // req.log is undefined on this public beacon path.
    logger.error({ err: error }, 'traffic track error');
    return res.status(500).json({ ok: false });
  }
});

/** How long after a visit its pageview may still be marked as a soft 404. */
const NOT_FOUND_MARK_WINDOW_MS = 10 * 60 * 1000;

/**
 * Marks the latest pageview of this address, visitor and browser in the last
 * minutes as a not-found title. Best effort: a failure is logged, the
 * beacon can't be retried.
 */
async function markNotFoundTitle({ brandId, url, visitorKey, userAgent, httpStatus }) {
  try {
    const since = new Date(Date.now() - NOT_FOUND_MARK_WINDOW_MS).toISOString();
    let query = supabaseAdmin
      .from('ai_traffic_logs')
      .select('id')
      .eq('brand_id', brandId)
      .eq('url', url)
      .eq('not_found_title', false)
      .gte('created_at', since);
    query = visitorKey ? query.eq('visitor_key', visitorKey) : query.is('visitor_key', null);
    query = userAgent ? query.eq('user_agent', userAgent) : query.is('user_agent', null);
    query =
      httpStatus === null ? query.is('http_status', null) : query.eq('http_status', httpStatus);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const { error: updateError } = await supabaseAdmin
      .from('ai_traffic_logs')
      .update({ not_found_title: true })
      .eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
  } catch (err) {
    logger.error({ err }, 'traffic not-found mark failed');
  }
}

export default router;
