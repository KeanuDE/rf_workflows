/**
 * Firecrawl API Client
 * Self-hosted Firecrawl instance for web scraping and Google search
 */

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || "http://firecrawl-api:3002";

// Response types from Firecrawl API
interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
    };
  };
  error?: string;
}

interface FirecrawlSearchResult {
  url: string;
  title?: string;
  description?: string;
}

interface FirecrawlSearchResponse {
  success: boolean;
  data?: FirecrawlSearchResult[];
  error?: string;
}

/**
 * Scrape a single URL with Firecrawl
 * Returns markdown content of the page
 */
export async function scrapeWithFirecrawl(url: string): Promise<string> {
  console.log(`[Firecrawl] Scraping: ${url}`);
  
  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      console.error(`[Firecrawl] HTTP error: ${response.status}`);
      return "";
    }

    const data = (await response.json()) as FirecrawlScrapeResponse;

    if (!data.success || !data.data?.markdown) {
      console.warn(`[Firecrawl] Scrape failed or empty:`, data.error);
      return "";
    }

    console.log(`[Firecrawl] Scraped ${data.data.markdown.length} chars`);
    return data.data.markdown;
  } catch (error) {
    console.error(`[Firecrawl] Scrape error:`, error);
    return "";
  }
}

/**
 * Search Google via Firecrawl's /search endpoint
 * Returns array of URLs from search results
 */
export async function searchGoogle(query: string, limit = 5): Promise<string[]> {
  console.log(`[Firecrawl] Google search: "${query}"`);
  
  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit,
        lang: "de",
        country: "de",
      }),
    });

    if (!response.ok) {
      console.error(`[Firecrawl] Search HTTP error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as FirecrawlSearchResponse;

    if (!data.success || !data.data) {
      console.warn(`[Firecrawl] Search failed:`, data.error);
      return [];
    }

    const urls = data.data.map((result) => result.url);
    console.log(`[Firecrawl] Found ${urls.length} results`);
    return urls;
  } catch (error) {
    console.error(`[Firecrawl] Search error:`, error);
    return [];
  }
}

/**
 * Search and scrape: Combines search + scrape for convenience
 * Searches Google for query, then scrapes the first relevant result
 */
export async function searchAndScrape(
  query: string,
  excludeDomains: string[] = []
): Promise<{ url: string; content: string } | null> {
  const urls = await searchGoogle(query);
  
  if (urls.length === 0) {
    return null;
  }

  // Filter out excluded domains
  const filteredUrls = urls.filter((url) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return !excludeDomains.some((domain) => 
        hostname.includes(domain.toLowerCase())
      );
    } catch {
      return false;
    }
  });

  if (filteredUrls.length === 0) {
    console.log(`[Firecrawl] All results filtered out`);
    return null;
  }

  const targetUrl = filteredUrls[0];
  if (!targetUrl) {
    return null;
  }
  
  const content = await scrapeWithFirecrawl(targetUrl);
  
  if (!content) {
    return null;
  }

  return { url: targetUrl, content };
}
