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

  it('keeps one H1, its first, and makes the others H2s', () => {
    const { html } = extractPageContent(
      '<body><main><h1>AEO vs SEO</h1><p>Intro.</p><h1>Key takeaways</h1><p>Short.</p></main></body>',
      'https://acme.example/aeo',
    );
    expect(html).toBe('<h1>AEO vs SEO</h1><p>Intro.</p><h2>Key takeaways</h2><p>Short.</p>');
  });

  it('keeps the article’s H1, not a logo’s or a site name’s before it', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const logo = extractPageContent(
      `<body><div id="page"><div class="top"><h1><a href="/"><img alt="Acme" src="/logo.png"></a></h1></div><div class="content"><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></div></div></body>`,
      'https://acme.example/forecasting',
    );
    expect(logo.html).toContain('<h1>Pipeline forecasting</h1>');
    expect(logo.html.match(/<h1/g)).toHaveLength(1);

    const branding = extractPageContent(
      `<body><main><div class="site-branding"><h1>Acme</h1></div><article><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></article></main></body>`,
      'https://acme.example/forecasting',
    );
    expect(branding.html).toContain('<h2>Acme</h2>');
    expect(branding.html).toContain('<h1>Pipeline forecasting</h1>');
  });

  it('keeps an article’s H1 over a site name’s when a byline line comes first', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><div class="site-branding"><h1>Acme</h1></div><article><p class="entry-meta">Published on October 22, 2026 by Ada Lovelace</p><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html).toContain('<h1>Pipeline forecasting</h1>');
    expect(html).not.toContain('<h1>Acme</h1>');
  });

  it('keeps the title H1 of an article and makes a section H1 in its text an H2', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><header class="site"><h1><a href="/">Acme</a></h1></header><article><h1 class="entry-title">Pipeline forecasting</h1><div class="entry-content"><p>${lead}</p><h1>Why forecasts miss</h1><p>${lead}</p></div></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Pipeline forecasting<\/h1>/);
    expect(html).toContain('<h2>Why forecasts miss</h2>');
  });

  it('takes the title from an article’s own header, not the site’s logo H1', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><header class="site"><h1><a href="/">Acme</a></h1></header><article><header class="entry-header"><h1 class="entry-title">Pipeline forecasting</h1></header><div class="entry-content"><p>${lead}</p><p>${lead}</p></div></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html.startsWith('<h1>Pipeline forecasting</h1>')).toBe(true);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain('Acme');
  });

  it('heads the content with the page title when its H1 sits outside it', () => {
    const { html, title } = extractPageContent(
      '<head><title>Lisbon &amp; more</title></head><body><div class="hero"><h1>Lisbon &amp; Porto</h1></div><main><p>Days out.</p></main></body>',
      'https://travel.example/lisbon',
    );
    expect(title).toBe('Lisbon & Porto');
    expect(html).toBe('<h1>Lisbon &amp; Porto</h1><p>Days out.</p>');
  });

  it('takes an article’s author box, byline, share buttons, related posts and comments out', () => {
    const { html } = extractPageContent(
      `<body><main><article>
        <header class="entry-header"><h1>Cold brew at home</h1></header>
        <div class="entry-meta">By Ada · 5 min read</div>
        <div class="entry-content">
          <p>Cold brew takes time, coarse grounds and cold water, nothing more.</p>
          <img src="/img/jar.jpg" alt="A jar of cold brew">
          <p>Steep it for twelve to eighteen hours, then strain it twice.</p>
          <div class="sharedaddy sd-sharing"><a href="https://x.com/share">Share on X</a><a href="https://facebook.com/share">Share on Facebook</a></div>
        </div>
        <div class="author-box"><img class="avatar" src="/ada.jpg" alt="Ada" width="96"><p>Ada writes about coffee, slowly and with care.</p></div>
      </article>
      <section class="related-posts"><h3>Related</h3><a href="/espresso">Espresso basics</a><a href="/latte">Latte art</a></section>
      <div id="comments"><p>Great post, thanks for sharing the recipe with us!</p></div>
      </main></body>`,
      'https://coffee.example/cold-brew',
    );
    expect(html).toContain('<h1>Cold brew at home</h1>');
    expect(html).toContain('coarse grounds and cold water');
    expect(html).toContain('src="https://coffee.example/img/jar.jpg"');
    for (const gone of [
      '5 min read',
      'Share on',
      'Ada writes',
      'ada.jpg',
      'Espresso basics',
      'Great post',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('finds the text on a page with no <main>, and keeps its H1 and lead but not the furniture', () => {
    const { html } = extractPageContent(
      `<body>
        <div class="announcement-bar"><a href="/trial">Stop measuring. Start improving.</a></div>
        <div class="page-wrapper"><section class="blog-hero"><div class="container">
          <div class="hero-content">
            <div class="columns"><a href="/blog">← Explore all</a><a href="/blog/ai">AI Search</a></div>
            <div class="blog-tag">AI Search</div>
            <h1>AI search monitoring</h1>
            <div class="blog-intro-text">Run one shared prompt set on every engine each week, and report each one apart.</div>
            <div class="div-block-7"><div>Cihan Geyik</div><img src="/eye.png" alt=""><div>8 min read</div><div>Last Updated:</div><div>October 21, 2026</div></div>
            <div class="blog-single-hero-img"><img class="all-img" src="/cihan.jpg" alt="Cihan"></div>
          </div>
          <div class="blog-details">
            <div class="blog-single-right">Explore with AI<a href="https://chatgpt.com/?q=x"><img src="/chatgpt.svg" alt="ChatGPT"></a><a href="https://claude.ai/new?q=x"><img src="/claude.svg" alt="Claude"></a>In this article<a href="#step-1">Step 1</a><a href="#step-2">Step 2</a></div>
            <div class="rich-text">
              <p>Many teams check ChatGPT one day, Google the next and Gemini when someone asks.</p>
              <figure><img src="/prompts.png" alt="The prompt list"></figure>
              <p>Record mentions, cited addresses and competitors, the same way every week.</p>
              <div class="ai-monitor-cta"><h2>How Ansvisor helps</h2><p>Our platform runs one prompt set across every engine and keeps every answer.</p></div>
              <div class="qoute-box"><img class="qoute-icon" src="/quote.svg" alt=""><p>Monitoring should explain why visibility changes, not only that it did.</p></div>
            </div>
          </div>
          <div class="author-box"><img src="/cihan-small.jpg" alt="Cihan"><h3>Cihan Geyik</h3><p>Cihan is the co-founder of Ansvisor, an open-source platform.</p></div>
          <div><a href="/blog">← Explore all</a><h3>Related Blog Posts</h3><a href="/blog/crawlers">How to check AI crawler access</a><a href="/blog/refresh">How to refresh content for AI search</a></div>
        </div></section>
        <section class="preferred-source"><p>Get more Ansvisor insights in Google, add us as a preferred source.</p><a href="https://google.com/preferences">Add Ansvisor</a></section>
        <div class="cta-footer"><p>Make your brand visible in AI answers, start a trial today.</p></div>
        </div>
      </body>`,
      'https://www.ansvisor.com/blog/ai-search-monitoring',
    );
    for (const kept of [
      '<h1>AI search monitoring</h1>',
      'Run one shared prompt set',
      'Many teams check ChatGPT',
      'src="https://www.ansvisor.com/prompts.png"',
      // The article's own call to action is its text.
      'How Ansvisor helps',
      'Monitoring should explain why',
    ]) {
      expect(html).toContain(kept);
    }
    for (const gone of [
      'Stop measuring',
      'Explore all',
      'blog-tag',
      '8 min read',
      'eye.png',
      'cihan.jpg',
      'Explore with AI',
      'chatgpt.svg',
      'Step 1',
      'quote.svg',
      'co-founder',
      'Related Blog Posts',
      'preferred source',
      'start a trial today',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('keeps a category’s long list of products, with their pictures', () => {
    const products = Array.from(
      { length: 12 },
      (_, i) =>
        `<div class="product-card"><a href="/p/${i}"><img class="product-thumb" src="/p${i}.jpg" alt="Runner ${i}"></a><a href="/p/${i}">Wool Runner number ${i}</a><span>$98</span></div>`,
    ).join('');
    const { html } = extractPageContent(
      `<body><main><h1>Men’s shoes</h1>
        <div class="collection-description"><p>Sustainable, supportive and wildly comfortable sneakers, ready when you are.</p></div>
        <div class="product-grid">${products}</div>
      </main></body>`,
      'https://shoes.example/collections/men',
    );
    expect(html).toContain('Wool Runner number 11');
    expect(html).toContain('src="https://shoes.example/p11.jpg"');
    expect(html).toContain('wildly comfortable sneakers');
  });

  it('drops what the page hides and tiny icons, but never the text for its name', () => {
    const { html } = extractPageContent(
      `<body><main><h1>Dinner menu</h1>
        <div class="menu-items">
          <p>Grilled sea bass with lemon, capers and new potatoes, our house dish.</p>
          <p>Slow roasted lamb shoulder with rosemary, garlic and white beans.</p>
          <img src="/star.png" width="16" height="16" alt="">
          <img class="h-full w-full object-cover" src="/bass.jpg" alt="Sea bass">
        </div>
        <div class="w-condition-invisible"><p>No dishes are on the menu this evening, sorry.</p></div>
        <p hidden>Hidden note for the kitchen staff only.</p>
      </main></body>`,
      'https://bistro.example/menu',
    );
    expect(html).toContain('Grilled sea bass');
    expect(html).toContain('src="https://bistro.example/bass.jpg"');
    for (const gone of ['star.png', 'No dishes', 'Hidden note']) {
      expect(html).not.toContain(gone);
    }
  });

  it('keeps a collapsed FAQ answer in the text, and hides what is hidden around it', () => {
    const { html } = extractPageContent(
      `<body><div hidden class="mobile-menu"><p>Shop all our coffee subscriptions and gifts today.</p></div>
        <main><h1>Coffee subscription FAQ</h1>
        <div class="faq">
          <p>Answers to what customers ask most about deliveries, plans and pausing.</p>
          <h3>Can I pause my plan?</h3>
          <div hidden><p>Yes, pause or skip any delivery from your account, up to two days before it ships.</p></div>
          <h3>Do you ship abroad?</h3>
          <div hidden="until-found"><p>We ship to the EU and the UK, with tracked delivery in three to five days.</p></div>
          <h3>Is grinding free?</h3>
          <div style="display: none"><p>Grinding is free: pick whole bean, espresso, filter or French press.</p></div>
        </div>
      </main></body>`,
      'https://acme-coffee.example/faq',
    );
    for (const kept of ['pause or skip', 'We ship to the EU', 'Grinding is free']) {
      expect(html).toContain(kept);
    }
    expect(html).toContain('hidden="until-found"');
    expect(html).not.toContain('Shop all our coffee');
  });

  it('judges images in the text as the text’s when the text area is the root', () => {
    const { html } = extractPageContent(
      `<body><article>
        <p>Our guide to brewing a better cup at home, with the gear you already own.</p>
        <p>Start with fresh beans, a scale and water just off the boil, then time it.</p>
        <img class="size-thumbnail" src="/pour-over.jpg" alt="Pour-over">
        <img class="avatar" src="/ada.jpg" alt="Ada">
      </article></body>`,
      'https://acme-coffee.example/guides/brew',
    );
    expect(html).toContain('src="https://acme-coffee.example/pour-over.jpg"');
    expect(html).not.toContain('ada.jpg');
  });
});
