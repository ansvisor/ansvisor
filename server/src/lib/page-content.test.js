import { describe, expect, it } from 'vitest';
import { extractPageContent } from './page-content.js';

/** A page brought into the Content Editor: its own content, not the site's frame. */

const PAGE = `<!doctype html><html><head>
  <title>Pricing | Northwind</title>
  <meta property="og:title" content="Northwind pricing">
  <script type="application/ld+json">{"@type":"Product","name":"Northwind <CRM>"}</script>
  <script>track()</script>
</head><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <h1>Plans for every team</h1>
    <p>Start <a href="/signup?plan=pro">free</a>, then <strong>scale</strong>.</p>
    <img src="/img/plans.png" alt="Plans">
    <form><input name="email"><button>Go</button></form>
    <aside>Related posts</aside>
  </main>
  <footer>© Northwind</footer>
</body></html>`;

describe('extractPageContent', () => {
  it('keeps the main content, without the site’s frame, forms or scripts', () => {
    const { title, html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(title).toBe('Plans for every team');
    expect(html).toContain('<h1>Plans for every team</h1>');
    expect(html).toContain('<strong>scale</strong>');
    for (const gone of ['Home', 'Related posts', '© Northwind', '<form', 'track()']) {
      expect(html).not.toContain(gone);
    }
  });

  it('makes links and images absolute, against the page’s address', () => {
    const { html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(html).toContain('href="https://northwind.example/signup?plan=pro"');
    expect(html).toContain('src="https://northwind.example/img/plans.png"');
  });

  it('keeps the schema JSON-LD after the content, safe inside its script', () => {
    const { html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(
      html.endsWith(
        '<script type="application/ld+json">{"@type":"Product","name":"Northwind \\u003cCRM>"}</script>',
      ),
    ).toBe(true);
  });

  it('reads an article, or the body, when there is no <main>', () => {
    const article = extractPageContent(
      '<body><nav>Menu</nav><article><h2>Guide</h2><p>Steps</p></article></body>',
      'https://acme.example/guide',
    );
    // No H1 and no title anywhere: nothing to head it with.
    expect(article.html).toBe('<h2>Guide</h2><p>Steps</p>');
    const body = extractPageContent('<body><p>Just text</p></body>', 'https://acme.example/x');
    expect(body.html).toBe('<p>Just text</p>');
  });

  it('heads the content with the page title when its H1 sits outside it', () => {
    const { html, title } = extractPageContent(
      '<head><title>Lisbon &amp; more</title></head><body><div class="hero"><h1>Lisbon &amp; Porto</h1></div><main><p>Days out.</p></main></body>',
      'https://travel.example/lisbon',
    );
    expect(title).toBe('Lisbon & Porto');
    expect(html).toBe('<h1>Lisbon &amp; Porto</h1><p>Days out.</p>');
  });
});
