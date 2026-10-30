import supabaseAdmin from '../config/supabase.js';
import { deliverEmail } from './email.js';
import logger from './logger.js';

/**
 * "Your first results are ready": the e-mail when a brand's first full
 * tracking run stamps. A new customer's first run takes 30 to 65 minutes,
 * and most leave the app meanwhile; the app says it in a toast to those
 * still in it. Sent once per person (profiles.first_results_emailed_at,
 * 00385) to the organization's members, through Resend (email.js), a silent
 * no-op where it isn't configured.
 */

/** The dashboard's origin, for the e-mail's link. */
function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ brandName: string }} brand
 * @returns {{ subject: string, html: string }}
 */
export function renderFirstResultsEmail({ brandName }) {
  // Brand Visibility: where the run's results are the moment it stamps.
  const url = `${appOrigin()}/dashboard/insights`;
  const name = escapeHtml(brandName);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">Your first results are ready</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">AI assistants have answered ${name}'s prompts for the first time. See where you stand against your competitors, and the first actions in the Action Center.</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">See your results</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    We send this once, when your first tracking finishes.
  </p>
</div>`;

  return { subject: `Your first results are ready: ${brandName}`, html };
}

/**
 * Whether this brand's run is the organization's first results: of its real
 * brands' stamped runs, the earliest is this brand's. A workspace that had
 * results before (another brand, or before this e-mail existed) isn't told
 * its "first" results are ready when it adds a brand. Two brands' first runs
 * stamping close together: the earlier stamp sends, the later doesn't.
 */
async function isOrganizationsFirstResults(orgId, brandId) {
  const { data: brands, error: brandsError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_demo', false);
  if (brandsError) throw new Error(brandsError.message);
  const ids = (brands ?? []).map((row) => row.id);
  if (ids.length === 0) return false;

  const { data: runs, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('brand_id')
    .in('brand_id', ids)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return runs?.[0]?.brand_id === brandId;
}

/**
 * Take the organization's members who were never sent it, in one update, so
 * two first runs finishing at once can't both send it. The ids taken.
 */
async function claimRecipients(orgId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ first_results_emailed_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .is('first_results_emailed_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id);
}

/** Give a claim back: nothing went out, so a later first run may send it. */
async function releaseRecipients(ids) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ first_results_emailed_at: null })
    .in('id', ids);
  if (error) logger.warn({ err: error }, 'could not give the first-results e-mail claim back');
}

async function emailsOf(ids) {
  const emails = [];
  for (const id of ids) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

/**
 * E-mail the brand's organization that its first results are in: the
 * members never sent it before, when this brand's run is the organization's
 * first results (not a demo brand's, nor a later brand's). 'sent', 'refused', 'unknown' (no answer:
 * Resend may have sent it, so the claim stays) or 'skipped' (nobody left to
 * send it to, or e-mail isn't set up).
 */
export async function sendFirstResultsEmail(brandId) {
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('name, organization_id, is_demo')
    .eq('id', brandId)
    .single();
  if (error) throw new Error(error.message);
  if (!brand?.organization_id || brand.is_demo) return 'skipped';
  if (!(await isOrganizationsFirstResults(brand.organization_id, brandId))) return 'skipped';

  const ids = await claimRecipients(brand.organization_id);
  if (ids.length === 0) return 'skipped';

  const to = await emailsOf(ids);
  const { subject, html } = renderFirstResultsEmail({ brandName: brand.name });
  const outcome = to.length > 0 ? await deliverEmail({ to, subject, html }) : 'skipped';
  if (outcome === 'refused' || outcome === 'skipped') await releaseRecipients(ids);
  return outcome;
}
