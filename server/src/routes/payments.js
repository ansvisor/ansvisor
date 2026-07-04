import express from 'express';
import fetch from 'node-fetch';
import crypto from 'node:crypto';

const router = express.Router();

// --- Paystack integration ---
router.post('/paystack/checkout', async (req, res) => {
  const { amount, email, currency = 'NGN', callback_url } = req.body || {};
  if (!amount || !email) return res.status(400).json({ error: 'missing_params' });

  const secret = process.env.PAYSTACK_SECRET;
  if (!secret) return res.status(500).json({ error: 'paystack_not_configured' });

  try {
    const resp = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100), // paystack expects kobo/cents
        currency,
        callback_url,
      }),
    });
    const body = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: 'paystack_error', details: body });
    return res.json({ success: true, authorization_url: body.data.authorization_url, reference: body.data.reference });
  } catch (err) {
    return res.status(500).json({ error: 'paystack_request_failed', message: err.message });
  }
});

// Paystack webhook receiver — verify signature using HMAC SHA512
router.post('/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET;
  const signature = req.headers['x-paystack-signature'];
  const raw = req.body;

  if (!secret || !signature) return res.status(400).json({ error: 'missing_signature_or_secret' });

  const computed = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  if (computed !== signature) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Minimal event handling — extend to update billing/subscriptions as needed
  console.log('[paystack] webhook event', event.event, event.data?.reference);

  // Acknowledge receipt
  res.json({ received: true });
});

// --- PayPal integration ---
async function paypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = process.env.PAYPAL_MODE === 'live' ? 'api' : 'api-m.sandbox';
  if (!clientId || !secret) throw new Error('paypal_not_configured');

  const tokenResp = await fetch(`https://${mode}.paypal.com/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenBody = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(tokenBody.error_description || 'paypal_token_error');
  return tokenBody.access_token;
}

router.post('/paypal/create-order', async (req, res) => {
  const { amount, currency = 'USD' } = req.body || {};
  if (!amount) return res.status(400).json({ error: 'missing_amount' });

  try {
    const token = await paypalAccessToken();
    const mode = process.env.PAYPAL_MODE === 'live' ? 'api' : 'api-m.sandbox';
    const resp = await fetch(`https://${mode}.paypal.com/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: currency, value: String(amount) } }],
      }),
    });
    const body = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: 'paypal_error', details: body });

    const approveLink = (body.links || []).find((l) => l.rel === 'approve')?.href;
    return res.json({ id: body.id, approve_url: approveLink });
  } catch (err) {
    return res.status(500).json({ error: 'paypal_request_failed', message: err.message });
  }
});

// PayPal webhook receiver — verify using PayPal verify-webhook-signature API
router.post('/paypal/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const mode = process.env.PAYPAL_MODE === 'live' ? 'api' : 'api-m.sandbox';
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return res.status(500).json({ error: 'paypal_webhook_not_configured' });

  const transmissionId = req.headers['paypal-transmission-id'];
  const transmissionTime = req.headers['paypal-transmission-time'];
  const certUrl = req.headers['paypal-cert-url'];
  const authAlgo = req.headers['paypal-auth-algo'];
  const transmissionSig = req.headers['paypal-transmission-sig'];

  if (!transmissionId || !transmissionTime || !transmissionSig) {
    return res.status(400).json({ error: 'missing_paypal_headers' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  try {
    const token = await paypalAccessToken();
    const verifyResp = await fetch(`https://${mode}.paypal.com/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    const verifyBody = await verifyResp.json();
    if (!verifyResp.ok || verifyBody.verification_status !== 'SUCCESS') {
      console.warn('[paypal] webhook verification failed', verifyBody);
      return res.status(401).json({ error: 'paypal_verification_failed', details: verifyBody });
    }

    console.log('[paypal] webhook event', event.event_type, event.resource?.id);
    return res.json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: 'paypal_verification_error', message: err.message });
  }
});

export default router;
