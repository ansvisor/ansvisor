import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ConsentView } from '@/lib/mcp-oauth/consent';

/**
 * The consent page's cards (MCP over OAuth, #2141; the approved mockup's
 * screens 2 to 6): what a person sees before an app connects as them.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { ConsentCard, ConsentErrorCard } = await import('./consent-card');

const actions = { approve: '/approve', deny: '/deny', switchAccount: '/switch' };

const claude: ConsentView = {
  requestId: 'req-1',
  app: { name: 'Claude', host: 'claude.ai', recognised: true, loopback: false },
  email: 'cihan@acme.com',
  role: 'admin',
  isAdmin: true,
  workspace: { name: 'Acme Inc.', planName: 'Growth' },
  brands: { all: true, count: 4 },
  access: 'ok',
  scopes: ['mcp:read', 'mcp:write'],
  writesNeedGrowth: false,
};

const agent: ConsentView = {
  ...claude,
  requestId: 'req-2',
  app: { name: 'MyAgent', host: '127.0.0.1', recognised: false, loopback: true },
  email: 'ayse@acme.com',
  role: 'analyst',
  isAdmin: false,
  workspace: { name: 'Acme Inc.', planName: 'Starter' },
  brands: { all: false, names: ['Acme Shoes', 'Acme Kids', 'Demo brand'] },
  writesNeedGrowth: true,
};

function html(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the consent card', () => {
  it('connects a recognised app: who, where, which brands, and what it may do', () => {
    const markup = html(<ConsentCard view={claude} actions={actions} />);
    const words = text(markup);
    expect(words).toContain('Connect Claude to Ansvisor');
    expect(words).toContain('Recognised app');
    expect(words).toContain("You'll go back to claude.ai");
    expect(words).toContain('cihan@acme.com · Admin');
    expect(words).toContain('Acme Inc. Growth plan');
    expect(words).toContain('All brands (4)');
    expect(words).toContain('Claude will be able to');
    expect(words).not.toContain('Allow it only if you started this connection');
    // Changes are allowed by default; the request goes with every answer.
    expect(markup.match(/<input[^>]*name="allow_changes"[^>]*>/)?.[0]).toContain('checked=""');
    expect(markup.match(/name="request" value="req-1"/g)).toHaveLength(2);
    expect(markup).toContain('formAction="/deny"');
    expect(markup).toContain('action="/approve"');
    expect(markup).not.toContain('data-slot="write-plan-note"');
  });

  it('warns about an app Ansvisor has not checked, running on this computer', () => {
    const words = text(html(<ConsentCard view={agent} actions={actions} />));
    expect(words).toContain('Connect “MyAgent” to Ansvisor');
    expect(words).toContain('Not checked by Ansvisor');
    expect(words).toContain("You'll go back to 127.0.0.1 (this computer)");
    expect(words).toContain('Allow it only if you started this connection.');
    expect(words).toContain('The name “MyAgent” comes from the app itself.');
    expect(words).toContain('any program there could use this address');
    expect(words).toContain('3 brands shared with you');
    expect(words).toContain('Acme Shoes, Acme Kids, Demo brand');
    expect(words).toContain('On Starter, apps can read. Changes need Growth');
  });

  it('names an app with no name as an app, and offers no changes when it asked to read only', () => {
    const markup = html(
      <ConsentCard
        view={{ ...agent, app: { ...agent.app, name: null }, scopes: ['mcp:read'] }}
        actions={actions}
      />,
    );
    expect(text(markup)).toContain('Connect an app to Ansvisor');
    expect(text(markup)).toContain("Ansvisor doesn't know who made this app.");
    expect(markup).not.toContain('name="allow_changes"');
  });

  it('blocks the free trial, with Choose a plan for an admin', () => {
    const markup = html(<ConsentCard view={{ ...claude, access: 'trial' }} actions={actions} />);
    const words = text(markup);
    expect(words).toContain('Connecting apps needs a paid plan');
    expect(words).toContain(
      'Claude can connect by sign-in once you choose Starter, Growth or Enterprise.',
    );
    expect(words).toContain('In the trial you can still connect with an API key');
    expect(words).toContain('Back to Claude');
    expect(markup).toContain('href="/dashboard/settings/billing"');
    expect(markup).not.toContain('Allow</button>');
  });

  it('blocks an ended plan, asking a member to ask an admin', () => {
    const markup = html(
      <ConsentCard
        view={{
          ...claude,
          app: { ...claude.app, name: 'ChatGPT', host: 'chatgpt.com' },
          access: 'ended',
          isAdmin: false,
          role: 'manager',
        }}
        actions={actions}
      />,
    );
    const words = text(markup);
    expect(words).toContain("Your workspace's plan has ended");
    expect(words).toContain('Ask an admin of Acme Inc. to choose a plan in Settings › Billing.');
    expect(words).toContain('Back to ChatGPT');
    expect(markup).not.toContain('/dashboard/settings/billing');
  });

  it('asks someone without a workspace to finish setting it up', () => {
    const markup = html(
      <ConsentCard
        view={{ ...claude, access: 'no_workspace', workspace: null, brands: null }}
        actions={actions}
      />,
    );
    expect(text(markup)).toContain('Finish setting up your workspace first');
    expect(markup).toContain('href="/dashboard"');
  });
});

describe('the error card', () => {
  it.each([
    ['invalid_redirect_uri', 'an address it never registered with Ansvisor'],
    ['unknown_client', "Ansvisor doesn't know this app."],
    ['expired', 'This request has expired.'],
    ['other_person', 'opened with another Ansvisor account'],
    ['rate_limited', 'Too many requests to connect'],
    ['invalid_request', 'missing something Ansvisor needs'],
  ] as const)('explains %s and sends nowhere', (code, words) => {
    const markup = html(<ConsentErrorCard code={code} />);
    expect(text(markup)).toContain("This connection request can't be used");
    expect(text(markup)).toContain(words);
    expect(text(markup)).toContain(`Code: ${code}`);
    expect(markup).not.toContain('<form');
  });
});
