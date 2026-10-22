/**
 * The Content Editor's page types (web/src/lib/content/drafts.ts, PAGE_TYPES)
 * as the person picks them (web/messages/en.json, contentEditor.pageTypes),
 * each with the format it asks for, so the writer, the brief and the Content
 * Agent write the page the person chose rather than read a key such as
 * "solution_page".
 */
export const PAGE_TYPE_FORMATS = {
  feature_page: 'Feature page: one capability, what it does and who it is for',
  solution_page: 'Use case page: how the product serves one use case, industry or team',
  comparison: 'Comparison: the options side by side, with a verdict',
  integration: 'Integration: what connecting one other tool does, and how to set it up',
  pricing: 'Pricing: the plans, their prices and what each includes',
  guide: 'How-to guide: numbered steps to get one thing done',
  blog_post: 'Blog post',
  docs_faq: 'Docs / FAQ: direct answers to questions about the product',
  product_page: 'Product page: one product, its specs, its uses and reasons to buy it',
  category_page: 'Category page: a range of products and how to choose among them',
  buying_guide: 'Buying guide: how to choose, the criteria and the picks',
  best_of: 'Best-of list: ranked picks, with the reason for each',
  policy: 'Policy: shipping, returns or terms, stated plainly',
  destination_page: 'Destination page: a place, what to do there and when to go',
  itinerary: 'Itinerary: a day-by-day plan',
  help_faq: 'Help & FAQ: direct answers to customer questions',
  definition:
    'Definition page: the term defined in the first sentence, then explained with examples',
  alternatives: 'Alternatives page: the options to one product, compared',
  collection_page: 'Collection page: a themed selection of products',
  sizing_guide: 'Sizing guide: how to find the right size, with a size chart',
};

/** A draft's page type as the model reads it: its name and format, or "not set". */
export function pageTypeFormat(pageType) {
  if (!pageType) return 'not set';
  return Object.hasOwn(PAGE_TYPE_FORMATS, pageType) ? PAGE_TYPE_FORMATS[pageType] : pageType;
}
