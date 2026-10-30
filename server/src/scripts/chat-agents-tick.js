/**
 * Chat's agents' minute, once (W2-16): asks the web app to fire the
 * Schedule triggers that are due and to sweep, as the server's cron does
 * every minute. For development, where the server's crons don't run
 * (NODE_ENV=development), and for trying a schedule by hand.
 *
 * Run from server/, with CHAT_AGENTIC=true, CHAT_INTERNAL_SECRET (the web's
 * same value) and PUBLIC_APP_URL (default http://localhost:3000) in .env,
 * and the web app running:
 *   node src/scripts/chat-agents-tick.js
 *
 * Prints what the tick did; never prints the secret.
 */
import 'dotenv/config';
import { tickChatAgents } from '../lib/chat-agents.js';

const res = await tickChatAgents();
if (!res) {
  console.log(
    'Nothing sent: set CHAT_AGENTIC=true and CHAT_INTERNAL_SECRET, and start the web app.',
  );
  process.exit(1);
}
console.log(res.status, JSON.stringify(res.body, null, 2));
process.exit(res.status === 200 ? 0 : 1);
