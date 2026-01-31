/**
 * Google Maps Scraper Service
 *
 * Nutzt Apify Actor um Google Maps Daten von Wettbewerbern zu validieren und anzureichern:
 * - Prüfung ob Unternehmen auf Google Maps existiert
 * - Rating und Bewertungen
 * - Validierung lokaler Präsenz
 *
 * Integriert mit dem Circuit Breaker aus crawler.ts
 */

import { ApifyClient } from "apify-client";
import { getApifyCircuitBreakerStatus } from "./crawler";

// ============================================================================
// Types
// ============================================================================

export interface GoogleMapsPlace {
  name: string;
  placeId: string | null;
  rating: number | null;
  reviewCount: number;
  address: string;
  phone: string | null;
  website: string | null;
  categories: string[];
  isVerified: boolean;
  latitude: number | null;
  longitude: number | null;
  priceLevel: string | null;
  openingHours: string[] | null;
}

export interface GoogleMapsValidation {
  exists: boolean;
  matchConfidence: number; // 0-1 wie sicher ist der Match
  place: GoogleMapsPlace | null;
  isLocalBusiness: boolean;
  matchReason: string;
}

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
// Google Maps Search
// ============================================================================

/**
 * Sucht ein Unternehmen auf Google Maps
 *
 * Actor: compass/crawler-google-places (kostengünstig, zuverlässig)
 *
 * @param searchQuery Suchbegriff (z.B. "Malermeister Müller München")
 * @param maxResults Maximale Anzahl Ergebnisse (default: 3)
 */
export async function searchGoogleMaps(
  searchQuery: string,
  maxResults: number = 3
): Promise<GoogleMapsPlace[]> {
  if (getApifyCircuitBreakerStatus().open) {
    console.log(`[GoogleMapsScraper] Circuit breaker open, skipping search`);
    return [];
  }

  console.log(`[GoogleMapsScraper] Searching: "${searchQuery}"`);

  try {
    const client = getApifyClient();

    const run = await client.actor("compass/crawler-google-places").call(
      {
        searchStringsArray: [searchQuery],
        maxCrawledPlacesPerSearch: maxResults,
        language: "de",
        // Optimierungen
        maxImages: 0,
        maxReviews: 0,
        scrapeReviewerName: false,
        scrapeReviewerId: false,
        scrapeReviewerUrl: false,
        scrapeReviewId: false,
        scrapeReviewUrl: false,
        scrapeResponseFromOwnerText: false,
      },
      { memory: 1024 }
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (items.length === 0) {
      console.log(`[GoogleMapsScraper] No results found for: ${searchQuery}`);
      return [];
    }

    const places: GoogleMapsPlace[] = items.map((item) => {
      const data = item as Record<string, unknown>;
      return {
        name: (data.title as string) || (data.name as string) || "",
        placeId: (data.placeId as string) || null,
        rating: (data.totalScore as number) || (data.rating as number) || null,
        reviewCount:
          (data.reviewsCount as number) || (data.reviews as number) || 0,
        address: (data.address as string) || (data.street as string) || "",
        phone: (data.phone as string) || null,
        website: (data.website as string) || (data.url as string) || null,
        categories: (data.categories as string[]) || [],
        isVerified: (data.isAdvertisement as boolean) === false,
        latitude: (data.location as { lat?: number })?.lat || null,
        longitude: (data.location as { lng?: number })?.lng || null,
        priceLevel: (data.price as string) || null,
        openingHours: (data.openingHours as string[]) || null,
      };
    });

    console.log(
      `[GoogleMapsScraper] Found ${places.length} places for: ${searchQuery}`
    );

    return places;
  } catch (error) {
    console.error(`[GoogleMapsScraper] Error searching Google Maps:`, error);
    return [];
  }
}

// ============================================================================
// Competitor Validation
// ============================================================================

/**
 * Validiert ob ein Wettbewerber auf Google Maps existiert
 *
 * Workflow:
 * 1. Extrahiere Firmennamen aus Domain
 * 2. Suche auf Google Maps mit Stadt
 * 3. Vergleiche Website-URLs
 * 4. Berechne Match-Confidence
 *
 * @param domain Die Domain des Wettbewerbers
 * @param city Stadt für lokale Suche
 * @param companyName Optional: Bekannter Firmenname
 */
export async function validateCompetitorOnMaps(
  domain: string,
  city: string,
  companyName?: string
): Promise<GoogleMapsValidation> {
  console.log(
    `[GoogleMapsScraper] Validating competitor: ${domain} in ${city}`
  );

  // Firmenname aus Domain extrahieren falls nicht angegeben
  const searchName = companyName || extractCompanyNameFromDomain(domain);
  const searchQuery = `${searchName} ${city}`;

  const places = await searchGoogleMaps(searchQuery, 5);

  if (places.length === 0) {
    return {
      exists: false,
      matchConfidence: 0,
      place: null,
      isLocalBusiness: false,
      matchReason: "Keine Google Maps Ergebnisse gefunden",
    };
  }

  // Finde den besten Match basierend auf Website-URL
  let bestMatch: GoogleMapsPlace | null = null;
  let bestConfidence = 0;
  let matchReason = "";

  for (const place of places) {
    const confidence = calculateMatchConfidence(domain, place);

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = place;

      if (confidence >= 0.9) {
        matchReason = "Website-URL stimmt überein";
      } else if (confidence >= 0.7) {
        matchReason = "Domain im Firmennamen gefunden";
      } else if (confidence >= 0.5) {
        matchReason = "Ähnlicher Firmenname";
      } else {
        matchReason = "Möglicher Match basierend auf Suche";
      }
    }
  }

  const exists = bestConfidence >= 0.5;
  const isLocalBusiness = exists && Boolean(bestMatch?.address);

  console.log(
    `[GoogleMapsScraper] Validation result for ${domain}: exists=${exists}, confidence=${bestConfidence.toFixed(2)}, reason="${matchReason}"`
  );

  return {
    exists,
    matchConfidence: bestConfidence,
    place: bestMatch,
    isLocalBusiness,
    matchReason,
  };
}

/**
 * Berechnet die Match-Confidence zwischen Domain und Google Maps Place
 */
function calculateMatchConfidence(
  domain: string,
  place: GoogleMapsPlace
): number {
  let confidence = 0;
  const domainLower = domain.toLowerCase().replace(/^www\./, "");
  const domainBase = domainLower.split(".")[0] || domainLower;

  // 1. Website-URL Match (höchste Priorität)
  if (place.website) {
    const placeWebsite = place.website
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");

    if (
      placeWebsite === domainLower ||
      placeWebsite.startsWith(domainLower) ||
      domainLower.startsWith(placeWebsite)
    ) {
      return 1.0; // Perfekter Match
    }

    // Domain in Website enthalten
    if (placeWebsite.includes(domainBase) || domainBase.includes(placeWebsite.split(".")[0] || "")) {
      confidence = Math.max(confidence, 0.9);
    }
  }

  // 2. Domain-Name im Firmennamen
  const placeName = place.name.toLowerCase();
  if (placeName.includes(domainBase) || domainBase.includes(placeName.replace(/\s/g, ""))) {
    confidence = Math.max(confidence, 0.7);
  }

  // 3. Teilweise Übereinstimmung
  const domainWords = domainBase.split(/[-_]/);
  const nameWords = placeName.split(/\s+/);

  const matchingWords = domainWords.filter((dw) =>
    nameWords.some((nw) => nw.includes(dw) || dw.includes(nw))
  );

  if (matchingWords.length > 0) {
    const wordMatchRatio = matchingWords.length / domainWords.length;
    confidence = Math.max(confidence, 0.3 + wordMatchRatio * 0.3);
  }

  return confidence;
}

/**
 * Extrahiert einen lesbaren Firmennamen aus einer Domain
 */
function extractCompanyNameFromDomain(domain: string): string {
  // Entferne www. und TLD
  let name = domain.replace(/^www\./, "").split(".")[0] || domain;

  // Ersetze Trennzeichen durch Leerzeichen
  name = name.replace(/[-_]/g, " ");

  // Kapitalisiere Wörter
  name = name
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return name;
}

// ============================================================================
// Batch Validation
// ============================================================================

/**
 * Validiert mehrere Wettbewerber auf Google Maps (sequenziell)
 *
 * @param competitors Array von Domains
 * @param city Stadt für lokale Suche
 * @param maxValidations Maximale Anzahl zu validierender Domains (default: 10)
 */
export async function validateCompetitorsOnMaps(
  competitors: string[],
  city: string,
  maxValidations: number = 10
): Promise<Map<string, GoogleMapsValidation>> {
  const results = new Map<string, GoogleMapsValidation>();
  const toValidate = competitors.slice(0, maxValidations);

  console.log(
    `[GoogleMapsScraper] Validating ${toValidate.length} competitors in ${city}`
  );

  for (const domain of toValidate) {
    const validation = await validateCompetitorOnMaps(domain, city);
    results.set(domain, validation);

    // Rate Limiting
    await sleep(2000);
  }

  // Zusammenfassung
  const existsCount = [...results.values()].filter((v) => v.exists).length;
  const localCount = [...results.values()].filter((v) => v.isLocalBusiness).length;

  console.log(
    `[GoogleMapsScraper] Validation complete: ${existsCount}/${toValidate.length} exist on Maps, ${localCount} are local businesses`
  );

  return results;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
