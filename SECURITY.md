# Security Policy

Thank you for helping keep Ansvisor and its users safe. This page says how to
report a vulnerability, what we cover, and what you can expect from us.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub
issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/ansvisor/ansvisor/security/advisories/new)**

Only you and the maintainers can see the report. Please include:

- what the issue is and what an attacker could do with it;
- the steps to reproduce it, or a proof of concept;
- the affected URL, endpoint, file or version (a commit hash helps);
- anything you know about a fix or a workaround.

You can write in English or Turkish.

## Supported versions

| Version                                            | Supported |
| -------------------------------------------------- | --------- |
| Ansvisor Cloud (`app.ansvisor.com`)                | Yes       |
| Latest release and `main` (self-hosted)            | Yes       |
| Older releases                                     | No        |

Ansvisor Cloud always runs the latest code. Fixes land on `main` and in the
next release; we don't backport them to older releases. If you self-host,
update to the latest release to get security fixes.

## What to expect

- **Acknowledgement** within 3 business days of your report.
- **First assessment** (whether we can reproduce it, and how severe it is)
  within 10 business days.
- **Updates** as we work on a fix, at least every 2 weeks until it is resolved.
- **Disclosure:** once the fix is released, we publish a GitHub Security
  Advisory and credit you, unless you'd rather stay anonymous. Please keep the
  details private until then; if a fix takes longer than 90 days, we'll agree
  on a disclosure date with you.

These are targets, not guarantees: Ansvisor is maintained by a small team.

## Scope

**In scope**

- The code in this repository: the web app (`web/`), the API server
  (`server/`), the database schema and its row-level security
  (`supabase/`), the MCP server and the store and CMS connectors.
- Ansvisor Cloud at `app.ansvisor.com`, including its API and MCP endpoint.

**Out of scope**

- Vulnerabilities in third-party services we use (for example Supabase,
  Vercel, Stripe, PostHog, Webflow or AI providers): please report them to
  that vendor. Tell us too if it affects Ansvisor users.
- Self-hosted instances run by someone else: a flaw in the code is in scope,
  but report a misconfigured instance to whoever runs it.
- Issues that are fixed in the latest release.
- Denial of service, load or stress testing, and spam.
- Social engineering or phishing of Ansvisor staff or users, and physical
  attacks.
- Reports from automated scanners without a working proof of concept.
- Issues that need a compromised device or browser, or physical access to an
  unlocked one.

## Safe harbor

If you make a good-faith effort to follow this policy while researching a
vulnerability, we consider your research authorized: we will not take or
support legal action against you for it, and we will work with you to
understand and fix the issue quickly. To stay within it:

- Test only against accounts and data you own, or have permission to use.
  Use a free trial or your own self-hosted instance where you can.
- Don't access, change or delete other people's data. If you reach it by
  accident, stop, don't keep a copy, and tell us in your report.
- Don't degrade the service for others (no denial of service, no high-volume
  automated testing against Ansvisor Cloud).
- Give us reasonable time to fix the issue before you disclose it.

If you are unsure whether something you want to do is allowed, ask us first
in a private report.
