import supabaseAdmin from '../../config/supabase.js';
import { readAllRpcRows } from '../rpc-pages.js';

/**
 * The report card's reads and writes (00472), with the service-role client:
 * the tables have no policies, and only this server reaches them.
 */

/** Postgres' code for a row a unique index refuses. */
const UNIQUE_VIOLATION = '23505';

const fail = (what, error) => {
  throw new Error(`report card ${what}: ${error.message}`);
};

/** The store, on `db`. Tests pass their own. */
export function reportCardStore(db = supabaseAdmin) {
  return {
    /** The company's latest card since `since` that isn't failed, or null. */
    async recentCard(domain, since) {
      const { data, error } = await db
        .from('report_cards')
        .select('id, status, created_at')
        .eq('domain', domain)
        .in('status', ['queued', 'running', 'ready'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) fail('read', error);
      return data?.[0] ?? null;
    },

    /**
     * Dollars spent by cards made since `since`, and how many are still to run.
     * Read in pages: PostgREST stops at 1000 rows whatever `limit` asks for,
     * and a month at the daily cap holds several thousand cards.
     */
    async spendSince(since) {
      const { data, error } = await readAllRpcRows('report_cards spend', (from, to) =>
        db
          .from('report_cards')
          .select('id, cost_usd, status')
          .gte('created_at', since.toISOString())
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (error) fail('spend', error);
      // A card written between two pages can repeat at the boundary: once each.
      const cards = new Map((data ?? []).map((row) => [row.id, row]));
      let spent = 0;
      let pending = 0;
      for (const row of cards.values()) {
        spent += Number(row.cost_usd) || 0;
        if (row.status === 'queued' || row.status === 'running') pending += 1;
      }
      return { spent, pending };
    },

    /** Cards set to start between `from` and `to`, failed ones too: they cost as they ran. */
    async cardsStarting(from, to) {
      const { count, error } = await db
        .from('report_cards')
        .select('id', { count: 'exact', head: true })
        .gte('run_after', from.toISOString())
        .lt('run_after', to.toISOString());
      if (error) fail('count', error);
      return count ?? 0;
    },

    /** The new card's id, or null when the company already has one being made (00472's index). */
    async insertCard(row) {
      const { data, error } = await db.from('report_cards').insert(row).select('id').single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) fail('insert', error);
      return data;
    },

    /** Cards running now. */
    async runningCards() {
      const { data, error } = await db
        .from('report_cards')
        .select('id, started_at, attempts')
        .eq('status', 'running')
        .limit(100);
      if (error) fail('running', error);
      return data ?? [];
    },

    /** Cards started since `since`. */
    async startedSince(since) {
      const { count, error } = await db
        .from('report_cards')
        .select('id', { count: 'exact', head: true })
        .gte('started_at', since.toISOString());
      if (error) fail('count', error);
      return count ?? 0;
    },

    /**
     * Takes the oldest card due by `now` for this server: queued → running,
     * only if no other run took it first. The card, or null for none.
     */
    async claimNext(now) {
      const { data: next, error } = await db
        .from('report_cards')
        .select('id, attempts')
        .eq('status', 'queued')
        .lte('run_after', now.toISOString())
        .order('run_after', { ascending: true })
        .limit(1);
      if (error) fail('queue', error);
      const card = next?.[0];
      if (!card) return null;
      const { data, error: claimError } = await db
        .from('report_cards')
        .update({ status: 'running', started_at: now.toISOString(), attempts: card.attempts + 1 })
        .eq('id', card.id)
        .eq('status', 'queued')
        .select('id, domain, site, company_name, country, language, attempts')
        .maybeSingle();
      if (claimError) fail('claim', claimError);
      return data ?? null;
    },

    /** What the person gave that the card reads: the first request's industry and deal value. */
    async cardInputs(cardId) {
      const { data, error } = await db
        .from('report_card_requests')
        .select('industry, deal_value, deal_currency')
        .eq('report_card_id', cardId)
        .order('created_at', { ascending: true })
        .limit(5);
      if (error) fail('inputs', error);
      const rows = data ?? [];
      const deal = rows.find((r) => r.deal_value !== null && r.deal_currency);
      return {
        industry: rows.find((r) => r.industry)?.industry ?? null,
        dealValue: deal ? { amount: Number(deal.deal_value), currency: deal.deal_currency } : null,
      };
    },

    /**
     * Ends a run: ready with its figures, or failed with why; with what it
     * cost either way. Only the run of `attempt` writes: one the tick took as
     * lost and started again (or failed) matches nothing.
     */
    async finishCard(cardId, attempt, fields) {
      const { error } = await db
        .from('report_cards')
        .update(fields)
        .eq('id', cardId)
        .eq('status', 'running')
        .eq('attempts', attempt);
      if (error) fail('finish', error);
    },

    /**
     * Puts a card a lost run left behind back in the queue, or fails it after
     * its tries; only while it is still that run's (`attempt`), running.
     */
    async releaseCard(cardId, attempt, fields) {
      const { error } = await db
        .from('report_cards')
        .update(fields)
        .eq('id', cardId)
        .eq('status', 'running')
        .eq('attempts', attempt);
      if (error) fail('release', error);
    },

    /** Requests whose card is ready or failed and whose e-mail hasn't gone, oldest first. */
    async undeliveredRequests(limit) {
      const { data, error } = await db
        .from('report_card_requests')
        .select(
          'id, first_name, email, outcome, email_attempts, report_cards!report_card_requests_report_card_id_fkey!inner(id, status, payload, site, created_at)',
        )
        .is('emailed_at', null)
        .in('report_cards.status', ['ready', 'failed'])
        // The ones not yet tried first: a PDF that keeps failing can't fill every sweep.
        .order('email_attempts', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) fail('undelivered', error);
      return data ?? [];
    },

    /** A try at a request's e-mail that will be made again: how many there have been. */
    async markEmailAttempt(requestId, attempts) {
      const { error } = await db
        .from('report_card_requests')
        .update({ email_attempts: attempts })
        .eq('id', requestId)
        .is('emailed_at', null);
      if (error) fail('attempt', error);
    },

    /**
     * Whether `email` already asked for this card: it is e-mailed once a
     * card, however often the form is sent (a resend costs nothing to run).
     */
    async askedBy(email, cardId) {
      const { count, error } = await db
        .from('report_card_requests')
        .select('id', { count: 'exact', head: true })
        .eq('email', email)
        .eq('report_card_id', cardId);
      if (error) fail('asked', error);
      return (count ?? 0) > 0;
    },

    /** What became of a request's e-mail; a request is e-mailed once. */
    async markEmailed(requestId, status, at) {
      const { error } = await db
        .from('report_card_requests')
        .update({ email_status: status, emailed_at: at.toISOString() })
        .eq('id', requestId)
        .is('emailed_at', null);
      if (error) fail('mark', error);
    },

    /** Deletes the requests older than `before` (12 months: the privacy notice). */
    async pruneRequests(before) {
      const { error, count } = await db
        .from('report_card_requests')
        .delete({ count: 'exact' })
        .lt('created_at', before.toISOString());
      if (error) fail('prune', error);
      return count ?? 0;
    },

    async insertRequest(row) {
      const { data, error } = await db
        .from('report_card_requests')
        .insert(row)
        .select('id')
        .single();
      if (error) fail('request insert', error);
      return data;
    },
  };
}
