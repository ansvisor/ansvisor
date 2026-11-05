/**
 * One free report card, made by hand without the queue or the database:
 * the same run the queue makes (lib/report-card/run.js), for a site you may
 * measure, written to a JSON file the web's PDF reads. It spends real money
 * on the engines, the model and the keyword call, so it prints the estimate
 * first and runs only with --spend.
 *
 *   node src/scripts/report-card-try.js --company Ansvisor --site ansvisor.com \
 *     --country US [--domain ansvisor.com] [--deal 99:USD] [--industry software] \
 *     --out /path/card.json [--spend]
 *
 * Needs CLORO_API_KEY, DataForSEO's login and the model's key in .env.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ENGINE_COUNT,
  QUESTION_MAX,
  estimatedCardUsd,
  reportCardLimits,
} from '../lib/report-card/config.js';
import { countryLanguage, isCountry } from '../lib/report-card/countries.js';
import { websiteHost } from '../lib/report-card/identity.js';
import { buildReportCard, costMeter } from '../lib/report-card/run.js';

const { values } = parseArgs({
  options: {
    company: { type: 'string' },
    site: { type: 'string' },
    domain: { type: 'string' },
    country: { type: 'string', default: 'US' },
    deal: { type: 'string' },
    industry: { type: 'string' },
    out: { type: 'string' },
    spend: { type: 'boolean', default: false },
  },
});

const site = websiteHost(values.site);
const country = String(values.country).toUpperCase();
if (!values.company || !site || !isCountry(country) || !values.out) {
  console.error('Give --company, --site, a --country code and --out.');
  process.exit(1);
}
const [amount, currency] = String(values.deal ?? '').split(':');
const dealValue = values.deal ? { amount: Number(amount), currency: currency || 'USD' } : null;
const limits = reportCardLimits();
console.log(
  `${values.company} (${site}), ${country}: about $${estimatedCardUsd(limits).toFixed(2)}` +
    ` (up to ${ENGINE_COUNT * QUESTION_MAX} answers at $${limits.answerUsd}, the keyword call $${limits.volumeUsd}, the model calls).`,
);
if (!values.spend) {
  console.log('Nothing run: add --spend to make it.');
  process.exit(0);
}

const meter = costMeter();
const started = Date.now();
try {
  const card = await buildReportCard(
    {
      companyName: values.company,
      domain: values.domain ? websiteHost(values.domain) : site,
      site,
      country,
      language: countryLanguage(country),
      industry: values.industry ?? null,
      dealValue,
    },
    { meter, limits },
  );
  writeFileSync(values.out, JSON.stringify({ ...card, costUsd: meter.total(), meter }, null, 2));
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)} s: $${meter.total().toFixed(3)}` +
      ` (models $${meter.models.toFixed(3)}, answers $${meter.answers.toFixed(3)}, keywords $${meter.keywords.toFixed(3)}). Written to ${values.out}`,
  );
} catch (err) {
  console.error(`Failed after $${meter.total().toFixed(3)}:`, err.message);
  process.exit(1);
}
