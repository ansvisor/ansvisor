const crypto = require('node:crypto');
const { apiWriteRequest, requireBrandId } = require('./api');

function createSubscribe(event) {
  return async (z, bundle) => {
    const brandId = requireBrandId(bundle);
    const secret = bundle && bundle.authData && bundle.authData.webhook_secret;
    if (typeof secret !== 'string' || !secret) {
      throw new Error('Add this brand’s webhook secret to the Ansvisor connection before enabling the trigger.');
    }

    const targetUrl = bundle && bundle.targetUrl;
    if (typeof targetUrl !== 'string' || !targetUrl) {
      throw new Error('Zapier did not provide a webhook target URL for this trigger.');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error('Zapier provided an invalid webhook target URL.');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('The Zapier webhook target URL must use HTTPS.');
    }

    const subscriptionId = crypto
      .createHash('sha256')
      .update([brandId, event, targetUrl].join('\0'), 'utf8')
      .digest('hex')
      .slice(0, 32);

    const result = await apiWriteRequest(z, bundle, 'POST', 'webhooks', {
      brand_id: brandId,
      event,
      webhook_url: targetUrl,
      webhook_secret: secret,
      subscription_id: subscriptionId,
    });

    if (!result || typeof result.id !== 'string') {
      throw new Error('Ansvisor did not return a webhook subscription ID.');
    }

    return { webhookConfigId: result.id };
  };
}

async function unsubscribe(z, bundle) {
  const id = bundle && bundle.subscribeData && bundle.subscribeData.webhookConfigId;
  if (!id) return {};
  await apiWriteRequest(z, bundle, 'DELETE', 'webhooks/' + encodeURIComponent(id));
  return {};
}

module.exports = { createSubscribe, unsubscribe };
