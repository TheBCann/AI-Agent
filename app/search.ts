import { DEFAULT_HEADERS } from "./headers";
import { chromium } from "playwright";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(str: string): string {
  return str.replace(/<[^>]+>/g, "").trim();
}

function extractResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  const resultBlocks = [
    ...html.matchAll(
      /<div class="links_main[^"]*result__body"[^>]*>([\s\S]*?)<div class="clear">/g,
    ),
  ];

  for (const block of resultBlocks) {
    const content = block[1];

    const titleMatch = content.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = content.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
    );
    const urlMatch = content.match(
      /class="result__url"[^>]*>\s*([\s\S]*?)\s*<\/a>/,
    );

    const title = titleMatch
      ? decodeHtmlEntities(stripTags(titleMatch[1]))
      : "";
    const snippet = snippetMatch
      ? decodeHtmlEntities(stripTags(snippetMatch[1]))
      : "";
    const url = urlMatch
      ? decodeHtmlEntities(stripTags(urlMatch[1])).trim()
      : "";

    if (title && snippet) {
      results.push({ title, url, snippet });
    }

    if (results.length >= 5) break;
  }

  return results;
}

function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
    .join("\n\n");
}

export async function search(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  let html: string;
  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
    });

    if (response.status === 429) {
      return "Search failed: rate limited. Try again in a moment.";
    }
    if (!response.ok) {
      return `Search failed: HTTP ${response.status}`;
    }

    html = await response.text();
  } catch (err) {
    return `Search failed: network error — ${err}`;
  }

  // DDG sometimes redirects to a "no results" page
  if (html.includes("No results found")) {
    return "No results found for that query.";
  }

  const results = extractResults(html);

  if (results.length === 0) {
    // HTML structure may have changed — return raw snippet as fallback
    console.error(
      "Warning: could not parse DDG results, HTML structure may have changed",
    );
    return "Search returned no parseable results.";
  }

  return formatResults(results);
}

export async function fetchUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) return `Fetch failed: HTTP ${response.status}`;
    const text = await response.text();

    // If it's RSS/XML, extract readable content from it
    if (text.trimStart().startsWith("<?xml") || text.includes("<rss")) {
      const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
      return (
        items
          .map((m) => {
            const title =
              m[1].match(
                /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/,
              )?.[1] ?? "";
            const desc =
              m[1].match(
                /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/,
              )?.[1] ?? "";
            const link = m[1].match(/<link>(.*?)<\/link>/)?.[1] ?? "";
            return `${title}\n${link}\n${stripTags(desc).slice(0, 200)}`;
          })
          .join("\n\n") || "No items found in feed."
      );
    }

    // Regular HTML — strip tags
    return text
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch (err) {
    return `Fetch failed: network error — ${err}`;
  }
}

export async function fetchWithBrowser(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Get visible text only — no tags, no scripts, no styles
    const text = await page.evaluate(() => document.body.innerText);
    return text.replace(/\s+/g, " ").trim().slice(0, 3000);
  } catch (err) {
    return `Browser fetch failed: ${err}`;
  } finally {
    await browser.close();
  }
}
