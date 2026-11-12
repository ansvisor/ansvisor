import { describe, expect, it, vi } from 'vitest';
// The helpers are re-exported from server.js, but the tests import the pure
// module: importing server.js itself starts the HTTP listener.
import { selfHostedCronMode, registerSelfHostedCron } from './lib/self-hosted-cron.js';

describe('selfHostedCronMode', () => {
  it("'tracking' with no vars set: stock self-hosted keeps tracking + cleanup", () => {
    expect(selfHostedCronMode({})).toBe('tracking');
  });

  it("'cleanup' when SELF_HOSTED_CRON='false': external cron tracks, cleanup stays", () => {
    expect(selfHostedCronMode({ SELF_HOSTED_CRON: 'false' })).toBe('cleanup');
  });

  it("'off' when IS_CLOUD='true': the Vercel cron owns the run", () => {
    expect(selfHostedCronMode({ IS_CLOUD: 'true' })).toBe('off');
  });

  it("'off' even with both an external cron and cloud mode set", () => {
    expect(selfHostedCronMode({ IS_CLOUD: 'true', SELF_HOSTED_CRON: 'false' })).toBe('off');
  });

  it("'tracking' when SELF_HOSTED_CRON is any other value", () => {
    expect(selfHostedCronMode({ SELF_HOSTED_CRON: 'true' })).toBe('tracking');
    expect(selfHostedCronMode({ SELF_HOSTED_CRON: 'yes' })).toBe('tracking');
  });
});

// Fakes for the registration tests: cronLib captures the callback passed to
// schedule() so the test can invoke it itself; the handlers and logger are
// vi.fn() spies.
function makeCronLib() {
  let callback;
  const cronLib = {
    schedule: vi.fn((_schedule, cb) => {
      callback = cb;
    }),
    fire: () => callback(),
  };
  return cronLib;
}

describe('registerSelfHostedCron', () => {
  it("cleanup mode: the callback runs cleanupOldJobs once and never runs tracking", async () => {
    const cronLib = makeCronLib();
    const runTracking = vi.fn();
    const cleanup = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };

    const mode = registerSelfHostedCron({
      cronLib,
      schedule: '0 6 * * *',
      runTracking,
      cleanup,
      log,
      env: { SELF_HOSTED_CRON: 'false' },
    });
    expect(mode).toBe('cleanup');
    expect(cronLib.schedule).toHaveBeenCalledTimes(1);
    expect(cronLib.schedule).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));

    await cronLib.fire();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(runTracking).toHaveBeenCalledTimes(0);
    expect(log.info).not.toHaveBeenCalledWith('self-hosted daily tracking triggered');
  });

  it("tracking mode: the callback runs both, tracking first, then cleanup", async () => {
    const cronLib = makeCronLib();
    const runTracking = vi.fn();
    const cleanup = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };

    const mode = registerSelfHostedCron({
      cronLib,
      schedule: '0 6 * * *',
      runTracking,
      cleanup,
      log,
      env: {},
    });
    expect(mode).toBe('tracking');

    await cronLib.fire();

    expect(runTracking).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(runTracking.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0]);
    expect(log.info).toHaveBeenCalledWith('self-hosted daily tracking triggered');
  });

  it("off mode (IS_CLOUD=true): no cron is registered at all", () => {
    const cronLib = makeCronLib();
    const runTracking = vi.fn();
    const cleanup = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };

    const mode = registerSelfHostedCron({
      cronLib,
      schedule: '0 6 * * *',
      runTracking,
      cleanup,
      log,
      env: { IS_CLOUD: 'true' },
    });

    expect(mode).toBe('off');
    expect(cronLib.schedule).toHaveBeenCalledTimes(0);
  });

  it('a tracking failure is caught and surfaced through log.error', async () => {
    const cronLib = makeCronLib();
    const runTracking = vi.fn().mockRejectedValue(new Error('tracking blew up'));
    const cleanup = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };

    registerSelfHostedCron({
      cronLib,
      schedule: '0 6 * * *',
      runTracking,
      cleanup,
      log,
      env: {},
    });

    await cronLib.fire();

    expect(log.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'self-hosted daily cron failed');
  });
});
