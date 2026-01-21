/**
 * Social Media Scraper Service
 *
 * Nutzt Apify Actors um Social Media Daten von Wettbewerbern zu sammeln:
 * - Instagram Profile Scraper
 * - Facebook Pages Scraper
 * - Website Social Links Extractor (aus Domain → Social Profiles)
 *
 * Integriert mit dem Circuit Breaker aus crawler.ts
 */

import { ApifyClient } from "apify-client";
import type {
  SocialLinks,
  InstagramProfile,
  FacebookPage,
  CompetitorProfile,
} from "../types";
import { getApifyCircuitBreakerStatus } from "./crawler";

// ============================================================================
// Apify Client
// ============================================================================

function getApifyClient(): ApifyClient {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("APIFY_API_TOKEN must be set in environment variables");
  }
  return new ApifyClient({ token });
}

// ============================================================================
// Social Links Extraction
// ============================================================================

/**
 * Extrahiert Social Media Links aus einer Website
 *
 * Strategie:
 * 1. Versuche mit Regex aus bekannten Crawl-Daten (wenn vorhanden)
 * 2. Fallback: Apify Website Content Crawler mit Regex
 *
 * @param url Die Website-URL
 * @param websiteContent Optional: Bereits gecrawlter Content
 */
export async function extractSocialLinks(
  url: string,
  websiteContent?: string
): Promise<SocialLinks> {
  console.log(`[SocialScraper] Extracting social links from: ${url}`);

  const emptyLinks: SocialLinks = {
    instagram: null,
    facebook: null,
    linkedin: null,
    twitter: null,
    youtube: null,
    tiktok: null,
  };

  // Regex-Patterns für Social Media Links
  const patterns = {
    instagram: /https?:\/\/(www\.)?instagram\.com\/([^\/\s"'<>]+)/gi,
    facebook: /https?:\/\/(www\.)?facebook\.com\/([^\/\s"'<>]+)/gi,
    linkedin: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/([^\/\s"'<>]+)/gi,
    twitter: /https?:\/\/(www\.)?(twitter|x)\.com\/([^\/\s"'<>]+)/gi,
    youtube: /https?:\/\/(www\.)?youtube\.com\/(channel|c|user|@)\/([^\/\s"'<>]+)/gi,
    tiktok: /https?:\/\/(www\.)?tiktok\.com\/@([^\/\s"'<>]+)/gi,
  };

  // Wenn Content vorhanden, direkt Regex anwenden
  if (websiteContent) {
    const links = extractLinksFromContent(websiteContent, patterns);
    if (hasAnySocialLink(links)) {
      console.log(`[SocialScraper] Found social links via regex:`, summarizeLinks(links));
      return links;
    }
  }

  // Fallback: Apify nutzen (wenn Circuit Breaker zu ist, leer zurückgeben)
  if (getApifyCircuitBreakerStatus().open) {
    console.log(`[SocialScraper] Circuit breaker open, skipping Apify`);
    return emptyLinks;
  }

  try {
    const client = getApifyClient();

    // Einfacher Web Scraper um die Startseite zu crawlen
    console.log(`[SocialScraper] Using Apify to fetch page content...`);

    const run = await client.actor("apify/web-scraper").call(
      {
        startUrls: [{ url }],
        pageFunction: `
          async function pageFunction(context) {
            const $ = context.jQuery;
            const html = $('body').html() || '';
            const links = [];
            $('a[href]').each((i, el) => {
              const href = $(el).attr('href');
              if (href) links.push(href);
            });
            return { html, links };
          }
        `,
        proxyConfiguration: { useApifyProxy: true },
        maxCrawlPages: 1,
        maxCrawlDepth: 0,
      },
      { memory: 1024 }
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const result = items[0] as { html?: string; links?: string[] } | undefined;

    if (result) {
      const allContent = [
        result.html || "",
        ...(result.links || []),
      ].join(" ");

      const links = extractLinksFromContent(allContent, patterns);
      console.log(`[SocialScraper] Found social links via Apify:`, summarizeLinks(links));
      return links;
    }
  } catch (error) {
    console.error(`[SocialScraper] Error extracting social links:`, error);
  }

  return emptyLinks;
}

/**
 * Extrahiert Social Links aus Content mit Regex
 */
function extractLinksFromContent(
  content: string,
  patterns: Record<string, RegExp>
): SocialLinks {
  const links: SocialLinks = {
    instagram: null,
    facebook: null,
    linkedin: null,
    twitter: null,
    youtube: null,
    tiktok: null,
  };

  for (const [platform, pattern] of Object.entries(patterns)) {
    const matches = content.match(pattern);
    const firstMatch = matches?.[0];
    if (firstMatch) {
      // Normalisiere URL und entferne Tracking-Parameter
      const urlPart1 = firstMatch.split("?")[0];
      const urlPart2 = urlPart1 ? urlPart1.split("#")[0] : "";
      // Entferne trailing slashes
      const cleanUrl = urlPart2 ? urlPart2.replace(/\/$/, "") : "";
      if (cleanUrl) {
        links[platform as keyof SocialLinks] = cleanUrl;
      }
    }
  }

  return links;
}

/**
 * Prüft ob mindestens ein Social Link gefunden wurde
 */
function hasAnySocialLink(links: SocialLinks): boolean {
  return Object.values(links).some((link) => link !== null);
}

/**
 * Erstellt eine kurze Zusammenfassung der Links für Logging
 */
function summarizeLinks(links: SocialLinks): string {
  const found = Object.entries(links)
    .filter(([_, v]) => v !== null)
    .map(([k, _]) => k);
  return found.length > 0 ? found.join(", ") : "none";
}

// ============================================================================
// Instagram Scraping
// ============================================================================

/**
 * Scrapet ein Instagram-Profil
 *
 * Actor: apify/instagram-profile-scraper
 * Kosten: ~$1.50 / 1000 Profile
 *
 * @param profileUrl Die Instagram-Profil-URL oder Username
 */
export async function scrapeInstagramProfile(
  profileUrl: string
): Promise<InstagramProfile | null> {
  if (getApifyCircuitBreakerStatus().open) {
    console.log(`[SocialScraper] Circuit breaker open, skipping Instagram scrape`);
    return null;
  }

  const username = extractInstagramUsername(profileUrl);
  if (!username) {
    console.warn(`[SocialScraper] Could not extract Instagram username from: ${profileUrl}`);
    return null;
  }

  console.log(`[SocialScraper] Scraping Instagram profile: @${username}`);

  try {
    const client = getApifyClient();

    const run = await client.actor("apify/instagram-profile-scraper").call(
      {
        usernames: [username],
      },
      { memory: 1024 }
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (items.length === 0) {
      console.warn(`[SocialScraper] No Instagram data found for @${username}`);
      return null;
    }

    const data = items[0] as Record<string, unknown>;

    const profile: InstagramProfile = {
      username: (data.username as string) || username,
      fullName: (data.fullName as string) || "",
      followersCount: (data.followersCount as number) || 0,
      followsCount: (data.followsCount as number) || 0,
      postsCount: (data.postsCount as number) || 0,
      biography: (data.biography as string) || "",
      externalUrl: (data.externalUrl as string) || null,
      verified: (data.verified as boolean) || false,
      profilePicUrl: (data.profilePicUrl as string) || "",
    };

    console.log(
      `[SocialScraper] Instagram @${username}: ${profile.followersCount} followers, ${profile.postsCount} posts`
    );

    return profile;
  } catch (error) {
    console.error(`[SocialScraper] Error scraping Instagram @${username}:`, error);
    return null;
  }
}

/**
 * Extrahiert den Username aus einer Instagram-URL
 */
function extractInstagramUsername(urlOrUsername: string): string | null {
  // Wenn es schon ein Username ist (kein Slash)
  if (!urlOrUsername.includes("/") && !urlOrUsername.includes(".")) {
    return urlOrUsername.replace("@", "");
  }

  // URL-Pattern
  const match = urlOrUsername.match(/instagram\.com\/([^\/\?#]+)/i);
  if (match && match[1]) {
    const username = match[1];
    // Filtere spezielle Seiten
    if (["p", "reel", "stories", "explore", "accounts"].includes(username)) {
      return null;
    }
    return username;
  }

  return null;
}

// ============================================================================
// Facebook Scraping
// ============================================================================

/**
 * Scrapet eine Facebook-Page
 *
 * Actor: apify/facebook-pages-scraper
 * Kosten: ~$6.60 / 1000 Pages
 *
 * @param pageUrl Die Facebook-Page-URL
 */
export async function scrapeFacebookPage(
  pageUrl: string
): Promise<FacebookPage | null> {
  if (getApifyCircuitBreakerStatus().open) {
    console.log(`[SocialScraper] Circuit breaker open, skipping Facebook scrape`);
    return null;
  }

  console.log(`[SocialScraper] Scraping Facebook page: ${pageUrl}`);

  try {
    const client = getApifyClient();

    const run = await client.actor("apify/facebook-pages-scraper").call(
      {
        startUrls: [{ url: pageUrl }],
      },
      { memory: 1024 }
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (items.length === 0) {
      console.warn(`[SocialScraper] No Facebook data found for: ${pageUrl}`);
      return null;
    }

    const data = items[0] as Record<string, unknown>;

    // Parse Rating (z.B. "94% recommend (839 Reviews)")
    let rating: number | null = null;
    let ratingCount: number | null = null;
    const ratingStr = data.rating as string;
    if (ratingStr) {
      const ratingMatch = ratingStr.match(/(\d+)%.*?\((\d+)/);
      if (ratingMatch && ratingMatch[1] && ratingMatch[2]) {
        rating = parseInt(ratingMatch[1], 10);
        ratingCount = parseInt(ratingMatch[2], 10);
      }
    }

    const page: FacebookPage = {
      title: (data.title as string) || "",
      likes: (data.likes as number) || 0,
      followers: (data.followers as number) || 0,
      email: (data.email as string) || null,
      phone: (data.phone as string) || null,
      website: (data.website as string) || null,
      rating,
      ratingCount,
      adStatus: (data.ad_status as string) || "",
      categories: (data.categories as string[]) || [],
    };

    console.log(
      `[SocialScraper] Facebook "${page.title}": ${page.followers} followers, ${page.likes} likes`
    );

    return page;
  } catch (error) {
    console.error(`[SocialScraper] Error scraping Facebook page:`, error);
    return null;
  }
}

// ============================================================================
// Social Score Calculation
// ============================================================================

/**
 * Berechnet einen Social Score basierend auf Instagram + Facebook Metriken
 *
 * Score-Verteilung (0-100):
 * - Instagram: max 50 Punkte
 *   - Follower: max 25 (bei 250k+)
 *   - Posts: max 10 (bei 1000+)
 *   - Verified: 15 Bonus
 * - Facebook: max 50 Punkte
 *   - Likes: max 20 (bei 100k+)
 *   - Followers: max 15 (bei 75k+)
 *   - Rating: max 10 (bei 100%)
 *   - Running Ads: 5 Bonus
 */
export function calculateSocialScore(
  instagram: InstagramProfile | null,
  facebook: FacebookPage | null
): number {
  let score = 0;

  if (instagram) {
    // Instagram Score (0-50 Punkte)
    const followerScore = Math.min(instagram.followersCount / 10000, 25);
    const postScore = Math.min(instagram.postsCount / 100, 10);
    const verifiedBonus = instagram.verified ? 15 : 0;
    score += followerScore + postScore + verifiedBonus;
  }

  if (facebook) {
    // Facebook Score (0-50 Punkte)
    const likesScore = Math.min(facebook.likes / 5000, 20);
    const followersScore = Math.min(facebook.followers / 5000, 15);
    const ratingScore = facebook.rating ? (facebook.rating / 100) * 10 : 0;
    const hasAdsBonus = facebook.adStatus?.toLowerCase().includes("running") ? 5 : 0;
    score += likesScore + followersScore + ratingScore + hasAdsBonus;
  }

  return Math.round(Math.min(100, score));
}

// ============================================================================
// Combined Social Data Collection
// ============================================================================

/**
 * Sammelt Social Media Daten für einen Wettbewerber
 *
 * Workflow:
 * 1. Social Links aus Website extrahieren (wenn Content vorhanden)
 * 2. Instagram Profil scrapen (wenn Link gefunden)
 * 3. Facebook Page scrapen (wenn Link gefunden)
 * 4. Social Score berechnen
 *
 * @param domain Die Domain des Wettbewerbers
 * @param websiteContent Optional: Bereits gecrawlter Website-Content
 */
export async function getCompetitorSocialData(
  domain: string,
  websiteContent?: string
): Promise<{
  socialLinks: SocialLinks;
  instagram: InstagramProfile | null;
  facebook: FacebookPage | null;
  socialScore: number;
}> {
  console.log(`[SocialScraper] Collecting social data for: ${domain}`);

  // 1. Social Links extrahieren
  const socialLinks = await extractSocialLinks(`https://${domain}`, websiteContent);

  // 2. Instagram scrapen (wenn vorhanden)
  let instagram: InstagramProfile | null = null;
  if (socialLinks.instagram) {
    instagram = await scrapeInstagramProfile(socialLinks.instagram);
    // Rate Limiting
    await sleep(2000);
  }

  // 3. Facebook scrapen (wenn vorhanden)
  let facebook: FacebookPage | null = null;
  if (socialLinks.facebook) {
    facebook = await scrapeFacebookPage(socialLinks.facebook);
    // Rate Limiting
    await sleep(2000);
  }

  // 4. Social Score berechnen
  const socialScore = calculateSocialScore(instagram, facebook);

  console.log(
    `[SocialScraper] ${domain}: Score=${socialScore}, IG=${instagram?.followersCount || 0}, FB=${facebook?.followers || 0}`
  );

  return {
    socialLinks,
    instagram,
    facebook,
    socialScore,
  };
}

/**
 * Sammelt Social Data für mehrere Wettbewerber (sequenziell)
 *
 * @param domains Array von Domains
 * @param maxDomains Maximale Anzahl (default: 10)
 */
export async function getCompetitorsSocialData(
  domains: string[],
  maxDomains: number = 10
): Promise<
  Map<
    string,
    {
      socialLinks: SocialLinks;
      instagram: InstagramProfile | null;
      facebook: FacebookPage | null;
      socialScore: number;
    }
  >
> {
  const results = new Map<
    string,
    {
      socialLinks: SocialLinks;
      instagram: InstagramProfile | null;
      facebook: FacebookPage | null;
      socialScore: number;
    }
  >();

  const domainsToProcess = domains.slice(0, maxDomains);
  console.log(
    `[SocialScraper] Processing ${domainsToProcess.length} domains (max: ${maxDomains})`
  );

  for (const domain of domainsToProcess) {
    const data = await getCompetitorSocialData(domain);
    results.set(domain, data);

    // Rate Limiting zwischen Domains
    await sleep(1500);
  }

  return results;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
