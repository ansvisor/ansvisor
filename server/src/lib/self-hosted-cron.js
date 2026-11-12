// What the in-process daily cron should do on this server.
// Cloud deployments: nothing (the Vercel cron in web/vercel.json triggers the
// run). Self-hosted with an external cron (SELF_HOSTED_CRON=false): keep the
// nightly job cleanup but skip the duplicate tracking run. Stock self-hosted:
// tracking + cleanup, unchanged.
export function selfHostedCronMode(env = process.env) {
  if (env.IS_CLOUD === 'true') return 'off';
  return env.SELF_HOSTED_CRON === 'false' ? 'cleanup' : 'tracking';
}

// Register the in-process daily cron with the mode's behavior; 'off'
// registers nothing. Dependencies are injected so the registration itself is
// testable offline: cronLib is node-cron, runTracking and cleanup are the
// real handlers, log is the logger. Log strings are part of the contract.
export function registerSelfHostedCron({ cronLib, schedule, runTracking, cleanup, log, env = process.env }) {
  const mode = selfHostedCronMode(env);
  if (mode === 'off') return 'off';
  cronLib.schedule(schedule, async () => {
    try {
      if (mode === 'tracking') {
        log.info('self-hosted daily tracking triggered');
        await runTracking();
      }
      await cleanup();
    } catch (err) {
      log.error({ err }, 'self-hosted daily cron failed');
    }
  });
  log.info({ schedule, mode }, 'self-hosted daily cron active');
  return mode;
}
