import { describe, expect, it } from 'vitest';
import { aiBotAccess } from './trust.js';

/**
 * The AI bot access check names the bots robots.txt blocks, so the Action
 * Center can say which crawlers a block affects (AC-001). Any explicit block
 * fails the check; robots.txt is read group by group, so a bot it allows is
 * no longer failed for the rules of the group after it.
 */
describe('aiBotAccess', () => {
  it('names each AI bot robots.txt disallows, and fails on any', () => {
    const robotsTxt = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      'User-agent: PerplexityBot',
      'Disallow: /',
    ].join('\n');
    expect(aiBotAccess.evaluate({ robotsTxt })).toEqual({
      status: 'fail',
      score: 0,
      evidence: {
        aiBotsMentioned: ['gptbot', 'claudebot', 'perplexitybot'],
        blocked: true,
        blockedBots: ['gptbot', 'perplexitybot'],
        // Each bot the report lists, as robots.txt reads for it; no live test ran.
        bots: [
          { key: 'gptbot', name: 'GPTBot', robots: 'blocked', http: null, live: null },
          {
            key: 'oai-searchbot',
            name: 'OAI-SearchBot',
            robots: 'allowed',
            http: null,
            live: null,
          },
          { key: 'chatgpt-user', name: 'ChatGPT-User', robots: 'allowed', http: null, live: null },
          {
            key: 'perplexitybot',
            name: 'PerplexityBot',
            robots: 'blocked',
            http: null,
            live: null,
          },
          { key: 'claudebot', name: 'ClaudeBot', robots: 'allowed', http: null, live: null },
          {
            key: 'google-extended',
            name: 'Google-Extended',
            robots: 'allowed',
            http: null,
            live: null,
          },
        ],
      },
    });
  });

  it("doesn't take the next group's rule for an allowed bot's", () => {
    const robotsTxt = 'User-agent: ClaudeBot\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /';
    expect(aiBotAccess.evaluate({ robotsTxt }).evidence.blockedBots).toEqual(['gptbot']);
    // A group naming several agents blocks each tracked AI bot among them.
    expect(
      aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: / # all',
      }).evidence.blockedBots,
    ).toEqual(['gptbot']);
  });

  it('lets a bot its own group allows in, though "*" blocks everyone else', () => {
    // The old reading took the "*" group's rule for ClaudeBot's.
    const robotsTxt = 'User-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nDisallow: /';
    const { status, evidence } = aiBotAccess.evaluate({ robotsTxt });
    expect(evidence.blockedBots).not.toContain('claudebot');
    expect(evidence.bots.find((b) => b.key === 'claudebot').robots).toBe('allowed');
    // The AI bots with no group of their own follow "*" (SA-008): they are kept out.
    expect(evidence.blockedBots).toEqual([
      'gptbot',
      'oai-searchbot',
      'chatgpt-user',
      'anthropic-ai',
      'perplexitybot',
      'google-extended',
    ]);
    expect(status).toBe('fail');
  });

  it('keeps every AI bot out when "*" disallows the whole site and none has a group', () => {
    const { status, evidence } = aiBotAccess.evaluate({ robotsTxt: 'User-agent: *\nDisallow: /' });
    expect(status).toBe('fail');
    expect(evidence.bots.every((b) => b.robots === 'blocked')).toBe(true);
    // A path under "*" isn't the whole site: no block, and no AI bot named.
    expect(aiBotAccess.evaluate({ robotsTxt: 'User-agent: *\nDisallow: /admin/' })).toMatchObject({
      status: 'warn',
      evidence: { blocked: false, blockedBots: [] },
    });
  });

  it('reads agents as crawlers match them, and lets "Allow: /" win', () => {
    // A version after the name still names the bot.
    expect(
      aiBotAccess.evaluate({ robotsTxt: 'User-agent: GPTBot/1.1\nDisallow: /' }).evidence
        .blockedBots,
    ).toEqual(['gptbot']);
    // A bot's groups count together, and allowing the whole site wins a tie.
    expect(
      aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /',
      }).status,
    ).toBe('pass');
  });

  describe('with the live bot test (SA-008)', () => {
    const live = (over = {}, tested = true) => ({
      tested,
      control: tested ? 200 : 403,
      bots: [
        { key: 'gptbot', name: 'GPTBot', http: 200, live: 'ok' },
        { key: 'oai-searchbot', name: 'OAI-SearchBot', http: 200, live: 'ok' },
        { key: 'chatgpt-user', name: 'ChatGPT-User', http: 200, live: 'ok' },
        { key: 'perplexitybot', name: 'PerplexityBot', http: 200, live: 'ok' },
        { key: 'claudebot', name: 'ClaudeBot', http: 200, live: 'ok' },
      ].map((b) =>
        tested ? { ...b, ...over[b.key] } : { ...b, http: null, live: 'inconclusive' },
      ),
    });
    const robotsTxt = 'User-agent: GPTBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /';

    it('warns, never fails, on a bot only the live test saw refused: the real crawler may get in', () => {
      // A CDN that checks a crawler's published addresses refuses a request
      // that only names the bot: can't tell, so neither a fail nor a 0, and
      // not the pass robots.txt alone would give.
      const { status, score, evidence } = aiBotAccess.evaluate({
        robotsTxt,
        botAccess: live({ perplexitybot: { http: 403, live: 'blocked' } }),
      });
      expect({ status, score }).toEqual({ status: 'warn', score: 0.5 });
      expect(evidence).toMatchObject({
        blocked: false,
        blockedBots: [],
        wafBlockedBots: ['perplexitybot'],
        liveTest: 'done',
        control: 200,
      });
      expect(evidence.bots.find((b) => b.key === 'perplexitybot')).toEqual({
        key: 'perplexitybot',
        name: 'PerplexityBot',
        robots: 'allowed',
        http: 403,
        live: 'blocked',
      });
      // Google-Extended has no crawler to ask: robots.txt alone.
      expect(evidence.bots.find((b) => b.key === 'google-extended')).toMatchObject({
        robots: 'allowed',
        http: null,
        live: null,
      });
    });

    it('warns on a page without robots.txt that the firewall closes to a bot', () => {
      expect(
        aiBotAccess.evaluate({
          robotsTxt: null,
          botAccess: live({ claudebot: { http: 401, live: 'blocked' } }),
        }),
      ).toMatchObject({
        status: 'warn',
        score: 0.5,
        evidence: { robotsTxt: false, wafBlockedBots: ['claudebot'] },
      });
    });

    it('keeps the robots.txt verdict when every bot is let in', () => {
      expect(aiBotAccess.evaluate({ robotsTxt, botAccess: live() })).toMatchObject({
        status: 'pass',
        score: 1,
        evidence: { liveTest: 'done' },
      });
      expect(aiBotAccess.evaluate({ robotsTxt, botAccess: live() }).evidence).not.toHaveProperty(
        'wafBlockedBots',
      );
    });

    it('takes no busy, slow or failing answer for a block, so the score holds', () => {
      const { status } = aiBotAccess.evaluate({
        robotsTxt,
        botAccess: live({
          gptbot: { http: 503, live: 'error' },
          claudebot: { http: null, live: 'no_answer' },
          perplexitybot: { http: null, live: 'not_tested' },
        }),
      });
      expect(status).toBe('pass');
    });

    it('concludes nothing when its own request was refused', () => {
      const { status, evidence } = aiBotAccess.evaluate({
        robotsTxt,
        botAccess: live({}, false),
      });
      expect(status).toBe('pass');
      expect(evidence).toMatchObject({ liveTest: 'inconclusive', control: 403 });
      expect(evidence.bots.find((b) => b.key === 'gptbot').live).toBe('inconclusive');
    });

    it('names a bot robots.txt blocks as robots.txt’s block, not the firewall’s', () => {
      const { evidence } = aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nDisallow: /',
        botAccess: live({ gptbot: { http: 403, live: 'blocked' } }),
      });
      expect(evidence.blockedBots).toEqual(['gptbot']);
      expect(evidence).not.toHaveProperty('wafBlockedBots');
    });

    it("still fails on robots.txt's block, with the firewall's refusals named beside it", () => {
      const { status, score, evidence } = aiBotAccess.evaluate({
        robotsTxt: 'User-agent: GPTBot\nDisallow: /',
        botAccess: live({ claudebot: { http: 403, live: 'blocked' } }),
      });
      expect({ status, score }).toEqual({ status: 'fail', score: 0 });
      expect(evidence).toMatchObject({ blockedBots: ['gptbot'], wafBlockedBots: ['claudebot'] });
    });
  });

  it('passes with no bot blocked, and warns without robots.txt', () => {
    expect(aiBotAccess.evaluate({ robotsTxt: 'User-agent: GPTBot\nAllow: /' })).toMatchObject({
      status: 'pass',
      evidence: { blocked: false, blockedBots: [] },
    });
    expect(aiBotAccess.evaluate({ robotsTxt: null }).status).toBe('warn');
  });
});
