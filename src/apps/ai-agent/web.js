// Direct CORS web tools. The external reader fallback requires explicit opt-in.
import { Readability } from "./vendor/readability.mjs";
import { cleanUntrusted } from "./agent.js";

const SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";
const READER_URL = "https://r.jina.ai/";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
const MAX_PAGE_CHARS = 4000; // about 1k tokens of a 6k budget
const MAX_SNIPPET_CHARS = 300;
const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json))/;
// Hidden or non-content nodes: removed before extraction so hidden text cannot carry instructions.
const NOISE = "script,style,noscript,template,iframe,object,svg,canvas,form,[hidden],[aria-hidden=true]," +
  "[style*='display:none'],[style*='display: none'],[style*='visibility:hidden'],[style*='visibility: hidden']";
const CHROME = "nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=search]";
const BLOCKS = "p,div,section,article,li,tr,h1,h2,h3,h4,h5,h6,pre,blockquote,br";

/** DOMParser documents have no browsing context: scripts never run and nothing loads. Only text leaves here. */
const parse = html => {
  // A template document is inert; fetched nodes are never adopted into the live page.
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('img,iframe,link,video,audio,source,object,embed').forEach(node => node.remove());
  const doc = document.implementation.createHTMLDocument('');
  doc.body.append(template.content.cloneNode(true));
  return doc;
};
const timedSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);

/** textContent with a newline after each block element, so paragraphs stay apart. */
function blockText(root) {
  root.querySelectorAll(BLOCKS).forEach((el) => el.after("\n"));
  return root.textContent;
}

export async function webSearch(query, { signal } = {}) {
  const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=5`, {
    credentials: "omit", signal: timedSignal(signal),
  });
  if (!res.ok) return { error: `Wikipedia search failed: HTTP ${res.status}` };
  const { pages = [] } = JSON.parse(await readCapped(res));
  if (!pages.length) return { results: [], note: "No Wikipedia articles matched" };
  return {
    results: pages.slice(0, 5).map((p) => ({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
      snippet: cleanUntrusted(`${p.description ?? ""}. ${parse(p.excerpt ?? "").body.textContent}`, MAX_SNIPPET_CHARS),
    })),
  };
}

/** Read at most MAX_BYTES of the body, so a huge or endless response cannot exhaust memory. */
async function readCapped(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.subarray(0, MAX_BYTES - size));
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return new Blob(chunks).text();
}

function extractArticle(html, url) {
  const doc = parse(html);
  doc.querySelectorAll(NOISE).forEach((el) => el.remove());
  // Site menus and footers outside the main content; an article's own <header> inside <article>/<main> stays.
  doc.querySelectorAll(CHROME).forEach((el) => el.parentElement?.closest("article,main") || el.remove());
  const base = doc.createElement("base");
  base.href = url; // lets Readability resolve relative links; we keep only text anyway
  doc.head.append(base);
  const article = new Readability(doc.cloneNode(true)).parse(); // Readability rewrites the DOM it is given
  if (!article) {
    // Index pages (home pages, listings) are not articles: keep the remaining body text.
    return { title: doc.title, text: blockText(doc.body ?? doc.documentElement) };
  }
  return { title: article.title, text: blockText(parse(article.content).body) };
}

/** Wikipedia article pages send no CORS headers, but the same article is served with CORS by its REST API. */
function corsFriendly(url) {
  const u = new URL(url);
  if (!(u.hostname === "wikipedia.org" || u.hostname.endsWith(".wikipedia.org")) || !u.pathname.startsWith("/wiki/")) return url;
  return `https://${u.hostname.replace(".m.", ".")}/api/rest_v1/page/html/${u.pathname.slice("/wiki/".length)}`;
}

async function fetchPage(url, { signal, allowReaderProxy = false } = {}) {
  try {
    return { res: await fetch(corsFriendly(url), { credentials: 'omit', signal: timedSignal(signal) }), source: 'direct' };
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw new Error('The site did not answer in time.');
    if (!allowReaderProxy) throw new Error('This site could not be read directly (CORS or network error). The external reader proxy is off; enable it in Settings only if you want to send this URL to Jina.');
    const res = await fetch(READER_URL + url, { headers: { 'X-Return-Format': 'html' }, credentials: 'omit', signal: timedSignal(signal) });
    return { res, source: 'jina' };
  }
}

export async function httpGet(url, options = {}) {
  const { res, source } = await fetchPage(url, options);
  if (!res.ok) return { error: `HTTP ${res.status}`, url, source };
  const type = res.headers.get("content-type") ?? "";
  if (type && !TEXTUAL.test(type)) return { error: `Not a text page (${type.split(";")[0]})`, url };
  const body = await readCapped(res);
  const isHtml = source === "jina" || /html/.test(type);
  const page = isHtml ? extractArticle(body, url) : { title: "", text: body };
  return { url, source, title: cleanUntrusted(page.title, 200), content: cleanUntrusted(page.text, MAX_PAGE_CHARS) };
}
