/**
 * Competitor Finder Service
 *
 * Kombiniert DataForSEO Labs API mit Entity-Klassifikation und Social Media Scraping
 * für eine umfassende Wettbewerbsanalyse.
 *
 * Workflow:
 * 1. Multi-Location SERP Competitors (regional: Hauptort + Nachbarstädte, bundesweit: Top 5 Städte)
 * 2. Blacklist-Filterung
 * 3. Entity-Klassifikation (Branche, Dienstleister/Händler)
 * 4. Social Media Data Collection
 * 5. Combined Score Berechnung (50% SEO + 50% Social)
 */

import type {
  CompetitorProfile,
  SERPCompetitorItem,
  EntityType,
  SocialLinks,
} from "../types";
import {
  getSERPCompetitors,
  getCompetitorsDomain,
  findLocation,
} from "./dataforseo";
import { classifyCompetitorEntity } from "./openai";
import { getCompetitorSocialData } from "./socialScraper";
import { isBlacklistedDomain } from "../constants/domainBlacklist";
import {
  TOP_5_GERMAN_CITIES,
  GERMANY_LOCATION_CODE,
  getNearbyCities,
  type GermanLocation,
} from "../constants/germanLocations";

// ============================================================================
// Multi-Location Strategy
// ============================================================================

/**
 * Ermittelt Location Codes basierend auf Operating Region
 *
 * Regional: Hauptort + bis zu 2 Nachbarstädte
 * Bundesweit: Top 5 deutsche Städte
 *
 * @param operatingRegion "regional" oder "nationwide"
 * @param city Die Hauptstadt des Kunden
 * @param fullLocation Vollständige Location (Stadt, Bundesland)
 */
export async function getLocationCodesForSearch(
  operatingRegion: string,
  city: string,
  fullLocation: string
): Promise<GermanLocation[]> {
  console.log(`[CompetitorFinder] Getting locations for ${operatingRegion} search...`);

  if (operatingRegion !== "regional") {
    // Bundesweit: Top 5 Städte
    const locations = TOP_5_GERMAN_CITIES.map((c) => ({
      name: c.name,
      code: c.locationCode,
    }));
    console.log(
      `[CompetitorFinder] Nationwide search: ${locations.map((l) => l.name).join(", ")}`
    );
    return locations;
  }

  // Regional: Hauptort + Nachbarstädte
  const locations: GermanLocation[] = [];

  // Hauptort
  const mainCode = await findLocation(fullLocation, city);
  if (mainCode) {
    locations.push({ name: city, code: mainCode });
    console.log(`[CompetitorFinder] Main location: ${city} (${mainCode})`);
  } else {
    console.warn(`[CompetitorFinder] Could not find location code for ${city}, using Germany default`);
    locations.push({ name: "Germany", code: GERMANY_LOCATION_CODE });
  }

  // Nachbarstädte (max 2)
  const nearbyCities = getNearbyCities(city);
  for (const nearbyCity of nearbyCities.slice(0, 2)) {
    try {
      const nearbyCode = await findLocation(nearbyCity, nearbyCity);
      if (nearbyCode) {
        locations.push({ name: nearbyCity, code: nearbyCode });
        console.log(`[CompetitorFinder] Nearby location: ${nearbyCity} (${nearbyCode})`);
      }
    } catch (error) {
      console.warn(`[CompetitorFinder] Could not find location for ${nearbyCity}`);
    }
  }

  console.log(
    `[CompetitorFinder] Regional search: ${locations.map((l) => l.name).join(", ")}`
  );
  return locations;
}

// ============================================================================
// Competitor Discovery
// ============================================================================

/**
 * Findet Wettbewerber über DataForSEO Labs API für mehrere Locations
 *
 * @param keywords Keywords des Kunden
 * @param locations Array von Locations (Name + Code)
 * @param maxPerLocation Max Wettbewerber pro Location
 */
async function discoverCompetitorsMultiLocation(
  keywords: string[],
  locations: GermanLocation[],
  maxPerLocation: number = 30
): Promise<Map<string, SERPCompetitorItem>> {
  const competitorMap = new Map<string, SERPCompetitorItem>();

  for (const location of locations) {
    console.log(`[CompetitorFinder] Searching SERP Competitors for ${location.name}...`);

    try {
      const competitors = await getSERPCompetitors(
        keywords,
        location.code,
        maxPerLocation
      );

      // Merge: Behalte höchsten Traffic-Score
      for (const comp of competitors) {
        const existing = competitorMap.get(comp.domain);
        const newTraffic = comp.full_domain_metrics?.organic?.etv || 0;
        const existingTraffic = existing?.full_domain_metrics?.organic?.etv || 0;

        if (!existing || newTraffic > existingTraffic) {
          competitorMap.set(comp.domain, comp);
        }
      }

      console.log(
        `[CompetitorFinder] ${location.name}: Found ${competitors.length} competitors, total unique: ${competitorMap.size}`
      );

      // Rate Limiting zwischen Locations
      await sleep(2000);
    } catch (error) {
      console.error(`[CompetitorFinder] Error for ${location.name}:`, error);
    }
  }

  return competitorMap;
}

// ============================================================================
// Filtering & Validation
// ============================================================================

/**
 * Filtert Wettbewerber mit Blacklist und entfernt eigene Domain
 */
function filterBlacklistedDomains(
  competitors: SERPCompetitorItem[],
  ownDomain: string
): SERPCompetitorItem[] {
  const ownHostname = extractHostname(ownDomain);

  return competitors.filter((comp) => {
    // Eigene Domain ausschließen
    if (comp.domain === ownHostname || comp.domain.includes(ownHostname)) {
      console.log(`[CompetitorFinder] Filtered own domain: ${comp.domain}`);
      return false;
    }

    // Blacklist-Check
    if (isBlacklistedDomain(`https://${comp.domain}`)) {
      console.log(`[CompetitorFinder] Filtered blacklisted: ${comp.domain}`);
      return false;
    }

    return true;
  });
}

/**
 * Extrahiert Hostname aus URL
 */
function extractHostname(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

// ============================================================================
// Entity Classification & Scoring
// ============================================================================

/**
 * Klassifiziert und bewertet Wettbewerber
 *
 * @param competitors Vorgefilterte Wettbewerber
 * @param customerGenre Branche des Kunden
 * @param customerEntityType Geschäftstyp des Kunden
 * @param maxToClassify Max Anzahl zu klassifizierender Domains
 */
async function classifyAndScoreCompetitors(
  competitors: SERPCompetitorItem[],
  customerGenre: string,
  customerEntityType: EntityType,
  maxToClassify: number = 20
): Promise<CompetitorProfile[]> {
  const profiles: CompetitorProfile[] = [];

  // Sortiere nach Traffic, nimm Top N
  const sortedByTraffic = [...competitors].sort((a, b) => {
    const trafficA = a.full_domain_metrics?.organic?.etv || 0;
    const trafficB = b.full_domain_metrics?.organic?.etv || 0;
    return trafficB - trafficA;
  });

  const toClassify = sortedByTraffic.slice(0, maxToClassify);
  console.log(
    `[CompetitorFinder] Classifying top ${toClassify.length} competitors by traffic...`
  );

  for (const comp of toClassify) {
    console.log(`[CompetitorFinder] Processing: ${comp.domain}`);

    try {
      // 1. Entity Classification
      const classification = await classifyCompetitorEntity(
        `https://${comp.domain}`,
        customerGenre,
        customerEntityType
      );

      // Rate Limiting
      await sleep(1500);

      // Nur relevante Wettbewerber weiterverarbeiten
      if (!classification.isCompany || !classification.isRelevantCompetitor) {
        console.log(
          `[CompetitorFinder] Skipped ${comp.domain}: ${classification.reason}`
        );
        continue;
      }

      // 2. Social Media Data
      const socialData = await getCompetitorSocialData(comp.domain);

      // 3. SEO Score berechnen (0-100)
      const seoScore = calculateSEOScore(comp);

      // 4. Overall Score (50% SEO + 50% Social)
      const overallScore = Math.round(seoScore * 0.5 + socialData.socialScore * 0.5);

      const profile: CompetitorProfile = {
        domain: comp.domain,
        seoTraffic: comp.full_domain_metrics?.organic?.etv || 0,
        rankedKeywords: comp.full_domain_metrics?.organic?.count || 0,
        avgPosition: comp.avg_position || 0,
        entityType: classification.entityType,
        detectedGenre: classification.detectedGenre,
        isRelevantCompetitor: true,
        socialLinks: socialData.socialLinks,
        instagramFollowers: socialData.instagram?.followersCount || null,
        facebookLikes: socialData.facebook?.likes || null,
        facebookFollowers: socialData.facebook?.followers || null,
        seoScore,
        socialScore: socialData.socialScore,
        overallScore,
      };

      profiles.push(profile);

      console.log(
        `[CompetitorFinder] Added ${comp.domain}: SEO=${seoScore}, Social=${socialData.socialScore}, Overall=${overallScore}`
      );
    } catch (error) {
      console.error(`[CompetitorFinder] Error processing ${comp.domain}:`, error);
    }
  }

  // Sortiere nach Overall Score
  profiles.sort((a, b) => b.overallScore - a.overallScore);

  return profiles;
}

/**
 * Berechnet SEO Score basierend auf Traffic und Keywords
 *
 * Score-Verteilung (0-100):
 * - Traffic (ETV): max 50 Punkte (bei 10000+ ETV)
 * - Ranked Keywords: max 30 Punkte (bei 1000+ Keywords)
 * - Avg Position: max 20 Punkte (bei Position 1)
 */
function calculateSEOScore(competitor: SERPCompetitorItem): number {
  const traffic = competitor.full_domain_metrics?.organic?.etv || 0;
  const keywords = competitor.full_domain_metrics?.organic?.count || 0;
  const avgPosition = competitor.avg_position || 100;

  // Traffic Score (0-50)
  const trafficScore = Math.min(traffic / 200, 50);

  // Keywords Score (0-30)
  const keywordsScore = Math.min(keywords / 33.33, 30);

  // Position Score (0-20) - Je niedriger die Position, desto besser
  const positionScore = Math.max(0, 20 - avgPosition / 5);

  return Math.round(trafficScore + keywordsScore + positionScore);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Findet und bewertet Wettbewerber
 *
 * Kompletter Workflow:
 * 1. Multi-Location SERP Competitors Discovery
 * 2. Optional: Domain Competitors (für zusätzliche Insights)
 * 3. Blacklist-Filterung
 * 4. Entity-Klassifikation
 * 5. Social Media Data Collection
 * 6. Combined Scoring
 *
 * @param keywords Keywords des Kunden
 * @param customerWebsite Website des Kunden
 * @param customerGenre Branche des Kunden
 * @param customerEntityType Geschäftstyp des Kunden
 * @param operatingRegion "regional" oder "nationwide"
 * @param city Hauptstadt des Kunden
 * @param fullLocation Vollständige Location
 * @param maxCompetitors Max Anzahl Wettbewerber im Ergebnis
 */
export async function findAndAnalyzeCompetitors(
  keywords: string[],
  customerWebsite: string,
  customerGenre: string,
  customerEntityType: EntityType,
  operatingRegion: string,
  city: string,
  fullLocation: string,
  maxCompetitors: number = 15
): Promise<CompetitorProfile[]> {
  console.log(`[CompetitorFinder] Starting competitor analysis...`);
  console.log(`[CompetitorFinder] Customer: ${customerWebsite}, Genre: ${customerGenre}, Type: ${customerEntityType}`);
  console.log(`[CompetitorFinder] Region: ${operatingRegion}, Location: ${city}`);
  console.log(`[CompetitorFinder] Keywords: ${keywords.length}`);

  // 1. Get locations for search
  const locations = await getLocationCodesForSearch(
    operatingRegion,
    city,
    fullLocation
  );

  // 2. Discover competitors via SERP Competitors API
  const competitorMap = await discoverCompetitorsMultiLocation(
    keywords.slice(0, 100), // Max 100 Keywords für Labs API
    locations,
    30
  );

  console.log(`[CompetitorFinder] Total unique competitors: ${competitorMap.size}`);

  // 3. Filter blacklisted domains
  const allCompetitors = [...competitorMap.values()];
  const filtered = filterBlacklistedDomains(allCompetitors, customerWebsite);

  console.log(`[CompetitorFinder] After blacklist filter: ${filtered.length}`);

  // 4. Classify and score
  const profiles = await classifyAndScoreCompetitors(
    filtered,
    customerGenre,
    customerEntityType,
    Math.min(maxCompetitors * 2, 25) // Klassifiziere mehr, um genug relevante zu finden
  );

  console.log(`[CompetitorFinder] Final relevant competitors: ${profiles.length}`);

  // Return top N
  return profiles.slice(0, maxCompetitors);
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
