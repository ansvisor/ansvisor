import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import { eeat, trust, trustBlocks, type TrustRead } from '@/lib/content/quality-checks';
import { qualityTodos } from '@/lib/content/quality-todos';
import type { SiteTrust } from '@/lib/content/site-trust';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { BeforePublish } = await import('./_before-publish');
type QualityRead = import('./_quality-tab').QualityRead;

/**
 * Before you publish (Quality spec §7, CE-041): the Trust < 60 warning, what
 * the CMS does, the JSON-LD to paste, and Mark ready (anyway, logged).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const siteTrust: SiteTrust = {
  checks: {
    about: { ok: true, url: 'https://acme.com/about' },
    contact: { ok: false, url: null },
    editorial: { ok: false, url: null },
    organizationSchema: { ok: true, url: 'https://acme.com/' },
    authorPages: { ok: true, authors: [{ name: 'Ada Lovelace', url: 'https://acme.com/ada' }] },
  },
  score: 3,
  checkedAt: '2026-10-23T12:00:00.000Z',
};
/** Three figures, one with a source: Trust 10 of 30 plus site trust 3 of 5, 37; sourced, 94. */
const lowTrust: TrustRead = trust({
  blocks: trustBlocks(
    '<p>Win rates rose 42% (<a href="https://research.example/r">report</a>).</p>' +
      '<p>Deals close $2.5 million faster.</p><p>Teams book 3x more demos.</p>',
  ),
  links: new Map(),
  brandDomains: ['acme.com'],
  siteTrust,
  now: Date.parse('2026-10-23T12:00:00Z'),
});

function quality(over: Partial<QualityRead> = {}): QualityRead {
  const author = over.author === undefined ? ada : over.author;
  const score = eeat({ author });
  return {
    readability: null,
    eeat: score,
    trust: lowTrust,
    author,
    canEdit: true,
    hasAuthors: true,
    brandName: 'Acme',
    team: 'Acme Team',
    siteTrust,
    todos: qualityTodos({ eeat: score, author, hasAuthors: true, canEdit: true }),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const onMarkReady = vi.fn();
const onFixFirst = vi.fn();
const writeText = vi.fn();

const clean = { placeholders: 0, imagesWithoutAlt: 0, linksBroken: 0, linksUnread: 0 };
const onContinue = vi.fn();
const onFillNow = vi.fn();
const onAddDisclosure = vi.fn();

async function render(
  q: QualityRead,
  {
    isNew = true,
    pageType = 'blog_post' as string | null,
    image = 'https://cdn.acme.com/pour-over.jpg' as string | null,
    linksPending = 0,
    paste = clean,
    mode = 'markReady' as 'markReady' | 'export' | 'send',
    contentByline = null as string | null,
    title = 'How small teams forecast',
    disclosureLine = null as string | null,
    disclosureAdded = false,
  } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BeforePublish
          mode={mode}
          paste={paste}
          onFillNow={onFillNow}
          contentByline={contentByline}
          onContinue={onContinue}
          onClose={() => {}}
          quality={q}
          title={title}
          isNew={isNew}
          pageType={pageType}
          image={image}
          linksPending={linksPending}
          onMarkReady={onMarkReady}
          onFixFirst={onFixFirst}
          disclosureLine={disclosureLine}
          disclosureAdded={disclosureAdded}
          onAddDisclosure={onAddDisclosure}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const alert = () => dialog().querySelector('[role="alert"]');
const button = (name: string) =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent === name);
const rows = () => [...dialog().querySelectorAll('li > div')].map((row) => row.textContent);
const jsonLd = () =>
  JSON.parse(
    dialog()
      .querySelector('pre')!
      .textContent!.replace(/^<script[^>]*>/, '')
      .replace(/<\/script>$/, ''),
  );
/** A Trust read as the checks would give it. */
const trustRead = (over: Partial<TrustRead>): TrustRead => ({
  score: 50,
  checks: [],
  broken: [],
  stale: [],
  dated: 0,
  unsourced: [],
  figures: 0,
  marks: [],
  aiClaims: 0,
  weak: [],
  classified: 0,
  mismatches: [],
  ...over,
});

beforeEach(() => {
  onMarkReady.mockReset();
  onFixFirst.mockReset();
  onContinue.mockReset();
  onFillNow.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BeforePublish', () => {
  it('warns under Trust 60 with the biggest reason, and logs Mark ready anyway', async () => {
    expect(lowTrust.score).toBe(37);
    await render(quality());
    expect(alert()!.textContent).toBe(
      'Trust 37, below 60. 2 sentences with figures have no source. You can mark it ready, but fixing them first raises Trust to about 94.' +
        'Mark ready anyway is logged, with this Trust.',
    );
    // The action has the focus, not the code (it moves there after a frame).
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(button('Mark ready anyway'));
    await act(async () => button('Mark ready anyway')!.click());
    expect(onMarkReady).toHaveBeenCalledWith({ trust: 37, reason: 'claimsSourced', count: 2 });
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith('Deals close $2.5 million faster.');
  });

  it('names the check that raises Trust most', async () => {
    await render(
      quality({
        trust: trustRead({
          score: 51,
          checks: [
            { id: 'claimsSourced', points: 25, max: 30 },
            { id: 'freshSources', points: 0, max: 7 },
          ],
          unsourced: ['Teams book 3x more demos.'],
          figures: 6,
          stale: [{ url: 'https://old.example/', text: 'An old study.' }],
          dated: 1,
        }),
      }),
    );
    expect(alert()!.textContent).toContain('1 of 1 dated source is over 24 months old');
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith('An old study.');
  });

  it("says Trust is low with no reason when the page's own checks pass", async () => {
    await render(
      quality({
        trust: trustRead({ score: 40, checks: [{ id: 'siteTrust', points: 2, max: 5 }] }),
      }),
    );
    expect(alert()!.textContent).toContain(
      'Trust 40, below 60. You can mark it ready, but Quality shows what would raise it.',
    );
    expect(button('Fix first')).toBeDefined();
    await act(async () => button('Mark ready anyway')!.click());
    expect(onMarkReady).toHaveBeenCalledWith({ trust: 40, reason: null, count: null });
  });

  it('marks it ready with no warning at Trust 60, or while Trust is unread', async () => {
    await render(
      quality({
        trust: trustRead({
          score: 60,
          checks: [{ id: 'claimsSourced', points: 18, max: 30 }],
          unsourced: ['A figure.'],
          figures: 2,
        }),
      }),
    );
    expect(alert()).toBeNull();
    await render(quality({ trust: null }));
    expect(alert()).toBeNull();
    expect(button('Fix first')).toBeUndefined();
    await act(async () => button('Mark ready')!.click());
    expect(onMarkReady).toHaveBeenCalledWith(null);
  });

  it('says when links are still being read, as Trust may change', async () => {
    await render(quality({ trust: null }), { linksPending: 2 });
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe(
      "Still reading 2 of the page's links, so Trust may change.",
    );
  });

  it('says what the CMS does: the author, the dates and the Article schema', async () => {
    await render(quality());
    expect(rows()).toEqual([
      "Author for your CMS · check itSet Ada Lovelace as the page's author in your CMS. Its template shows the byline; nothing is added to the content.",
      'Visible published and updated dates · check itMost CMSs (WordPress, Webflow, Shopify) add these for you. Check your page.',
      'Article schema with datePublished and dateModified · check itOften added by your CMS. If not, paste the code below into the page.',
      'Ready to paste · doneNo placeholders, all images have alt text, all links work.',
    ]);
  });

  it('gives the JSON-LD from the page, author and site to copy, dated today', async () => {
    await render(quality());
    expect(jsonLd()).toMatchObject({
      '@type': 'Article',
      headline: 'How small teams forecast',
      image: 'https://cdn.acme.com/pour-over.jpg',
      author: {
        '@type': 'Person',
        name: 'Ada Lovelace',
        url: 'https://acme.com/ada',
        sameAs: ['https://www.linkedin.com/in/ada'],
      },
      publisher: { '@type': 'Organization', name: 'Acme', url: 'https://acme.com/' },
    });
    expect(jsonLd().datePublished).toBe(jsonLd().dateModified);
    expect(dialog().textContent).toContain("The dates are today's");
    await act(async () => button('Copy JSON-LD')!.click());
    expect(writeText).toHaveBeenCalledWith(dialog().querySelector('pre')!.textContent);
    expect(toast.success).toHaveBeenCalledWith('JSON-LD copied');
  });

  it('leaves the headline out while the title has a placeholder, and says why', async () => {
    await render(quality(), { title: 'How [number] small teams forecast' });
    expect(jsonLd()).not.toHaveProperty('headline');
    expect(dialog().textContent).toContain(
      'The title still has a placeholder in square brackets, so the code leaves the headline out.',
    );
    expect(button('Copy JSON-LD')).toBeDefined();
  });

  it("leaves the author out while the authors aren't read", async () => {
    await render(quality({ eeat: null, author: null }));
    expect(rows()[0]).toContain("The authors couldn't be read here");
    expect(jsonLd()).not.toHaveProperty('author');
  });

  it('names an author the person confirmed their site names as checked, not missing (00271)', async () => {
    await render(quality({ author: null, authorConfirmed: { real: true, profile: false } }));
    expect(rows()[0]).toContain('Author named on your site · check it');
    expect(rows()[0]).toContain('Check your CMS sets them as the author.');
    // Not the brand's Organization: the author isn't named here, so left out.
    expect(jsonLd()).not.toHaveProperty('author');
  });

  it('names the team byline as missing, and keeps a live page its published date', async () => {
    await render(quality({ author: null }), { isNew: false, image: null });
    const [author, , schema] = rows();
    expect(author).toBe(
      "No author yet · missingThe page goes out as Acme Team, with the brand's Organization schema. A real author raises E-E-A-T.",
    );
    expect(schema).toContain('Article schema with dateModified');
    expect(schema).toContain('It gives only the updated date');
    expect(jsonLd().author).toEqual({
      '@type': 'Organization',
      name: 'Acme',
      url: 'https://acme.com/',
    });
    expect(jsonLd()).not.toHaveProperty('datePublished');
    expect(jsonLd()).not.toHaveProperty('image');
  });

  it('says what keeps it from being ready to paste, with Fill now for a placeholder (CE-057)', async () => {
    await render(quality({ trust: null }), {
      paste: { placeholders: 2, imagesWithoutAlt: 1, linksBroken: 1, linksUnread: 1 },
    });
    expect(rows().at(-1)).toBe(
      "Not ready to paste yet · missing2 placeholders still open · 1 image has no alt text · 1 link doesn't answer · 1 link wasn't read: check it",
    );
    await act(async () => button('Fill now')!.click());
    expect(onFillNow).toHaveBeenCalled();
    await render(quality({ trust: null }), { paste: { ...clean, imagesWithoutAlt: 1 } });
    expect(button('Fill now')).toBeUndefined();
  });

  it('says links are still being read, or were not read, to check them', async () => {
    await render(quality({ trust: null }), {
      paste: { ...clean, linksUnread: 2 },
      linksPending: 2,
    });
    expect(rows().at(-1)).toBe(
      'Ready to paste · check itNo placeholders, all images have alt text; 2 links are still being read.',
    );
    await render(quality({ trust: null }), { paste: { ...clean, linksUnread: 2 } });
    expect(rows().at(-1)).toBe(
      "Ready to paste · check itNo placeholders, all images have alt text; 2 links weren't read: check them.",
    );
  });

  it('tells a link still being read from one no read is coming for', async () => {
    // One read still coming; the other link's site refused its read.
    await render(quality({ trust: null }), {
      paste: { ...clean, linksUnread: 2 },
      linksPending: 1,
    });
    expect(rows().at(-1)).toBe(
      "Ready to paste · check itNo placeholders, all images have alt text; 1 link is still being read, 1 wasn't read: check it.",
    );
    await render(quality({ trust: null }), {
      paste: { ...clean, placeholders: 1, linksUnread: 3 },
      linksPending: 1,
    });
    expect(rows().at(-1)).toBe(
      "Not ready to paste yet · missing1 placeholder still open · 1 link is still being read, 2 weren't read: check them",
    );
  });

  it('goes on to Export from Export, the warning saying so, with no log', async () => {
    await render(quality(), { mode: 'export' });
    expect(alert()!.textContent).toContain('You can export it, but fixing them first');
    expect(alert()!.textContent).not.toContain('logged');
    expect(button('Mark ready anyway')).toBeUndefined();
    // The dialog moves focus in after it opens.
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Continue to export')));
    await act(async () => button('Continue to export')!.click());
    expect(onContinue).toHaveBeenCalled();
    expect(onMarkReady).not.toHaveBeenCalled();
  });

  it('goes on to the Send dialog from Send to CMS, the warning saying so', async () => {
    await render(quality(), { mode: 'send' });
    expect(alert()!.textContent).toContain('You can send it to your CMS, but fixing them first');
    expect(alert()!.textContent).not.toContain('logged');
    await act(async () => button('Continue to send')!.click());
    expect(onContinue).toHaveBeenCalled();
    expect(onMarkReady).not.toHaveBeenCalled();
  });

  it('goes to what would raise Trust from Export too', async () => {
    await render(quality(), { mode: 'export' });
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith(expect.any(String));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('says the exports put the byline under the H1 for a brand that adds it to content', async () => {
    await render(quality(), { contentByline: 'By Ada Lovelace' });
    expect(rows()[0]).toBe(
      'Byline in the content · check itExports put "By Ada Lovelace" under the H1: this brand adds the byline to content, for a CMS with no author field.',
    );
    // The line as it goes out, in the brand's language.
    await render(quality(), { contentByline: 'Yazar: Ada Lovelace' });
    expect(rows()[0]).toContain('Exports put "Yazar: Ada Lovelace" under the H1');
  });

  it("gives no Article for a page that isn't one", async () => {
    await render(quality(), { pageType: 'product_page' });
    expect(rows()).toEqual([
      expect.stringContaining('Author for your CMS'),
      'Schema for this page type · check itCheck what your CMS adds for it (Product, ItemList…). The code Ansvisor gives here is for articles.',
      expect.stringContaining('Ready to paste'),
    ]);
    expect(dialog().querySelector('pre')).toBeNull();
    expect(button('Copy JSON-LD')).toBeUndefined();
  });

  it('asks a page that puts the brand forward for its disclosure, with Add line (CE-050)', async () => {
    const line = 'Disclosure: the product this page recommends is offered by Acme.';
    const pick = { found: false, show: 'Our top pick is the Acme Ridge 28' };
    onAddDisclosure.mockReset();
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }), {
      disclosureLine: line,
    });
    expect(rows()).toContainEqual(
      expect.stringContaining('The page recommends Acme without a disclosure'),
    );
    await act(async () => button('Add line')!.click());
    expect(onAddDisclosure).toHaveBeenCalledWith(line);
    expect(rows()).toContainEqual(expect.stringContaining('Disclosure added'));
    expect(button('Add line')).toBeUndefined();
    // Opened again before the page is read: the page has the line, so it's added.
    act(() => root.unmount());
    root = createRoot(container);
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }), {
      disclosureLine: line,
      disclosureAdded: true,
    });
    expect(rows()).toContainEqual(expect.stringContaining('Disclosure added'));
    expect(button('Add line')).toBeUndefined();

    // Said: its words. No line in the page's language: the person writes it.
    await render(
      quality({
        aiChecks: { balanced: null, disclosure: { found: true, show: 'Acme makes the Ridge 28' } },
      }),
    );
    expect(rows()).toContainEqual(
      expect.stringContaining('The page says so: "Acme makes the Ridge 28"'),
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }));
    expect(rows()).toContainEqual(
      expect.stringContaining("Add a line saying the product the page recommends is Acme's own"),
    );
    expect(button('Add line')).toBeUndefined();
    // Where it doesn't apply: no row.
    await render(quality({ aiChecks: { balanced: null, disclosure: null } }));
    expect(rows().join(' ')).not.toContain('recommends');
  });
});
