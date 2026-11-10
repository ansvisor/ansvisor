import * as cheerio from 'cheerio';

/**
 * HubSpot's blog for Send to CMS (#2140; 00522): the blogs a brand's HubSpot
 * account has, and its blog posts, read and written through the brand's
 * HubSpot sign-in (lib/hubspot/client.js; Composio keeps the token). Posts
 * are only ever drafts: HubSpot's own Publish puts one live.
 *
 * `request` is a bound HubSpot client (hubspotClient). Every call needs the
 * sign-in's `content` scope: without it HubSpot answers 403 MISSING_SCOPES,
 * which the client names 'scopes' and the card and the send ask to connect
 * HubSpot again for.
 */

/** HubSpot's limits on a post's name, slug, meta description and featured image alt text. */
const NAME_MAX = 255;
const SLUG_MAX = 255;
const META_MAX = 500;
const ALT_MAX = 255;

/**
 * The account's blogs, as the card offers them: `{ id, name, url }`. Read
 * from the blog settings API, newest name first as HubSpot lists them.
 */
export async function listBlogs(request) {
  const { data } = await request({ path: '/cms/v3/blog-settings/settings', query: { limit: 100 } });
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((blog) => blog && blog.id !== undefined && blog.id !== null)
    .map((blog) => ({
      id: String(blog.id),
      name: String(blog.name || blog.publicTitle || blog.slug || blog.id).slice(0, 300),
      url: typeof blog.absoluteUrl === 'string' ? blog.absoluteUrl : null,
    }));
}

/**
 * The page's HTML as a HubSpot post body: its JSON-LD goes to the post's
 * head (headHtml) instead, where HubSpot keeps scripts.
 */
export function toHubspotBody(html) {
  const $ = cheerio.load(html, null, false);
  $('script').remove();
  return $.html();
}

/** The post's head: the page's JSON-LD, every "<" escaped so nothing in it ends the script. */
export function headHtml(jsonLd = []) {
  return jsonLd
    .map(
      (block) =>
        `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    )
    .join('\n');
}

/** A blog post's fields from a page, for the blog `blogId`. */
export function postOf({ page, html, jsonLd, blogId }) {
  const image = page.featuredImage;
  return {
    name: page.title.slice(0, NAME_MAX),
    contentGroupId: blogId,
    ...(page.slug ? { slug: page.slug.slice(0, SLUG_MAX) } : {}),
    htmlTitle: (page.metaTitle || page.title).slice(0, NAME_MAX),
    ...(page.metaDescription ? { metaDescription: page.metaDescription.slice(0, META_MAX) } : {}),
    postBody: toHubspotBody(html),
    headHtml: headHtml(jsonLd),
    useFeaturedImage: Boolean(image?.src),
    ...(image?.src
      ? { featuredImage: image.src, featuredImageAltText: (image.alt ?? '').slice(0, ALT_MAX) }
      : {}),
  };
}

/** Makes a new draft post. Answers HubSpot's post (its `id`). */
export async function createDraftPost(request, post) {
  const { data } = await request({ method: 'POST', path: '/cms/v3/blogs/posts', body: post });
  return data ?? {};
}

/**
 * Writes a post's draft version: a post never published stays a draft; a
 * live one keeps what people read until the person publishes the changes in
 * HubSpot. HubSpot's 404 (the post deleted) is the client's 'not_found'.
 */
export async function updateDraftPost(request, postId, post) {
  const { data } = await request({
    method: 'PATCH',
    path: `/cms/v3/blogs/posts/${encodeURIComponent(postId)}/draft`,
    body: post,
  });
  return data ?? {};
}

/** A post, or null when HubSpot no longer has it. */
export async function readPost(request, postId) {
  try {
    const { data } = await request({
      path: `/cms/v3/blogs/posts/${encodeURIComponent(postId)}`,
    });
    return data ?? null;
  } catch (err) {
    if (err?.code === 'not_found') return null;
    throw err;
  }
}

/** Whether HubSpot shows the post live: published (not scheduled, not a draft), with its address. */
export function liveUrl(post) {
  const state = String(post?.currentState ?? post?.state ?? '').toUpperCase();
  if (state !== 'PUBLISHED' && state !== 'PUBLISHED_OR_SCHEDULED') return null;
  if (state === 'PUBLISHED_OR_SCHEDULED' && post?.publishDate) {
    const at = Date.parse(post.publishDate);
    if (Number.isFinite(at) && at > Date.now()) return null;
  }
  const url = typeof post?.url === 'string' ? post.url : null;
  return url && /^https?:\/\//i.test(url) ? url : null;
}
