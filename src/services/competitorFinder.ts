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
  console.log(`\n[CompetitorFinder] ===== COMPETITOR DISCOVERY START =====`);
  console.log(`[CompetitorFinder] Keywords (${keywords.length}): ${keywords.slice(0, 5).join(", ")}...`);
  console.log(`[CompetitorFinder] Locations: ${locations.map(l => l.name).join(", ")}`);
  console.log(`[CompetitorFinder] Max per location: ${maxPerLocation}`);
  
  const competitorMap = new Map<string, SERPCompetitorItem>();
  let totalErrors = 0;
  let totalLocationsProcessed = 0;

  for (const location of locations) {
    totalLocationsProcessed++;
    console.log(`\n[CompetitorFinder] ---- Location ${totalLocationsProcessed}/${locations.length}: ${location.name} (code: ${location.code}) ----`);

    try {
      console.log(`[CompetitorFinder] Calling getSERPCompetitors API...`);
      const startTime = Date.now();
      
      const competitors = await getSERPCompetitors(
        keywords,
        location.code,
        maxPerLocation
      );
      
      const duration = Date.now() - startTime;
      console.log(`[CompetitorFinder] API call completed in ${duration}ms`);
      console.log(`[CompetitorFinder] Found ${competitors.length} competitors from API`);

      if (competitors.length === 0) {
        console.warn(`[CompetitorFinder] No competitors found for ${location.name}. Checking...`);
        console.log(`[CompetitorFinder] - Keywords used: ${keywords.slice(0, 3).join(", ")}`);
        console.log(`[CompetitorFinder] - Location code: ${location.code}`);
        
        if (keywords.length < 5) {
          console.warn(`[CompetitorFinder] Not enough keywords for competitor discovery`);
        }
        
        await sleep(2000);
        continue;
      }

      // Merge: Behalte höchsten Traffic-Score
      let mergedCount = 0;
      let skippedCount = 0;
      
      for (const comp of competitors) {
        const existing = competitorMap.get(comp.domain);
        const newTraffic = comp.full_domain_metrics?.organic?.etv || 0;
        const existingTraffic = existing?.full_domain_metrics?.organic?.etv || 0;

        if (!existing || newTraffic > existingTraffic) {
          competitorMap.set(comp.domain, comp);
          if (existing) {
            mergedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      console.log(
        `[CompetitorFinder] ${location.name}: Found ${competitors.length} competitors | Merge: ${mergedCount} updated, ${skippedCount} skipped | Total unique: ${competitorMap.size}`
      );

      // Log top 5 competitors
      const topCompetitors = Array.from(competitorMap.values())
        .sort((a, b) => (b.full_domain_metrics?.organic?.etv || 0) - (a.full_domain_metrics?.organic?.etv || 0))
        .slice(0, 5);
      
      console.log(`[CompetitorFinder] Top 5 competitors so far:`);
      topCompetitors.forEach((comp, i) => {
        const traffic = comp.full_domain_metrics?.organic?.etv || 0;
        const keywordsCount = comp.full_domain_metrics?.organic?.count || 0;
        console.log(`[CompetitorFinder]   ${i + 1}. ${comp.domain} - Traffic: ${traffic}, Keywords: ${keywordsCount}`);
      });

      // Rate Limiting zwischen Locations
      await sleep(2000);
    } catch (error) {
      totalErrors++;
      console.error(`[CompetitorFinder] Error for ${location.name}:`, error);
      console.error(`[CompetitorFinder] Error type: ${error instanceof Error ? error.constructor.name : 'Unknown'}`);
      if (error instanceof Error) {
        console.error(`[CompetitorFinder] Error message: ${error.message}`);
        console.error(`[CompetitorFinder] Error stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`);
      }
      
      if (totalErrors >= 2) {
        console.warn(`[CompetitorFinder] Too many errors (${totalErrors}), breaking discovery loop`);
        break;
      }
    }
  }

  console.log(`\n[CompetitorFinder] ===== COMPETITOR DISCOVERY END =====`);
  console.log(`[CompetitorFinder] Total locations processed: ${totalLocationsProcessed}`);
  console.log(`[CompetitorFinder] Total errors: ${totalErrors}`);
  console.log(`[CompetitorFinder] Final unique competitors: ${competitorMap.size}`);
  
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
    `[CompetitorFinder] Classifying top ${toClassify.length} competitors by traffic with parallel queue...`
  );

  const results = await Promise.all(
    toClassify.map(async (comp) => {
      console.log(`[CompetitorFinder] Processing: ${comp.domain}`);

      try {
        // 1. Entity Classification
        const classification = await classifyCompetitorEntity(
          `https://${comp.domain}`,
          customerGenre,
          customerEntityType
        );

        // Nur relevante Wettbewerber weiterverarbeiten
        if (!classification.isCompany || !classification.isRelevantCompetitor) {
          console.log(
            `[CompetitorFinder] Skipped ${comp.domain}: ${classification.reason}`
          );
          return null;
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

        console.log(
          `[CompetitorFinder] Added ${comp.domain}: SEO=${seoScore}, Social=${socialData.socialScore}, Overall=${overallScore}`
        );

        return profile;
      } catch (error) {
        console.error(`[CompetitorFinder] Error processing ${comp.domain}:`, error);
        return null;
      }
    })
  );

  // Filter null results and sort by Overall Score
  profiles.push(
    ...results.filter((p): p is CompetitorProfile => p !== null)
  );
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
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[CompetitorFinder] **** COMPETITOR ANALYSIS WORKFLOW START ****`);
  console.log(`[CompetitorFinder] ${new Date().toISOString()}`);
  console.log(`[CompetitorFinder] ${"=".repeat(70)}`);
  console.log(`[CompetitorFinder] INPUT DATA:`);
  console.log(`[CompetitorFinder] - Customer website: ${customerWebsite}`);
  console.log(`[CompetitorFinder] - Customer genre: ${customerGenre}`);
  console.log(`[CompetitorFinder] - Customer entity type: ${customerEntityType}`);
  console.log(`[CompetitorFinder] - Operating region: ${operatingRegion}`);
  console.log(`[CompetitorFinder] - Location: ${city} (${fullLocation})`);
  console.log(`[CompetitorFinder] - Keywords count: ${keywords.length}`);
  console.log(`[CompetitorFinder] - Keywords sample: ${keywords.slice(0, 5).join(", ")}`);
  console.log(`[CompetitorFinder] - Max competitors to return: ${maxCompetitors}`);
  console.log(``);

  let competitors: CompetitorProfile[] = [];

  try {
    // 1. Get locations for search
    console.log(`[CompetitorFinder] Step 1: Getting locations for search...`);
    const locations = await getLocationCodesForSearch(
      operatingRegion,
      city,
      fullLocation
    );
    console.log(`[CompetitorFinder] Step 1 completed: ${locations.length} locations found`);

    // 2. Discover competitors via SERP Competitors API
    console.log(`[CompetitorFinder] Step 2: Discovering competitors via SERP API...`);
    const competitorMap = await discoverCompetitorsMultiLocation(
      keywords.slice(0, 100), // Max 100 Keywords für Labs API
      locations,
      30
    );

    console.log(`[CompetitorFinder] Step 2 completed: ${competitorMap.size} unique competitors found`);

    if (competitorMap.size === 0) {
      console.warn(`[CompetitorFinder] No competitors discovered! Possible reasons:`);
      console.warn(`[CompetitorFinder] 1. Location code invalid for: ${city}`);
      console.warn(`[CompetitorFinder] 2. Keywords have no search volume`);
      console.warn(`[CompetitorFinder] 3. SERP Competitors API error/rate limit`);
      console.warn(`[CompetitorFinder] 4. Industry too niche for competition`);
      console.log(`[CompetitorFinder] Continuing with empty competitor list...`);
      return [];
    }

    // 3. Filter blacklisted domains
    console.log(`[CompetitorFinder] Step 3: Filtering blacklisted domains...`);
    const allCompetitors = [...competitorMap.values()];
    const filtered = filterBlacklistedDomains(allCompetitors, customerWebsite);
    console.log(`[CompetitorFinder] Step 3 completed: ${filtered.length}/${allCompetitors.length} competitors after blacklist filter`);

    // 4. Classify and score
    console.log(`[CompetitorFinder] Step 4: Classifying and scoring competitors...`);
    const profiles = await classifyAndScoreCompetitors(
      filtered,
      customerGenre,
      customerEntityType,
      Math.min(maxCompetitors * 2, 25) // Klassifiziere mehr, um genug relevante zu finden
    );

    console.log(`[CompetitorFinder] Step 4 completed: ${profiles.length} relevant competitors found`);
    console.log(`[CompetitorFinder] Step 4 completed: ${allCompetitors.length - profiles.length} competitors filtered out (irrelevant)`);

    // Return top N
    competitors = profiles.slice(0, maxCompetitors);
    console.log(`[CompetitorFinder] Step 5: Selecting top ${competitors.length} competitors by score...`);
    
    console.log(`\n[CompetitorFinder] FINAL COMPETITORS:`);
    competitors.forEach((comp, i) => {
      console.log(`[CompetitorFinder] ${i + 1}. ${comp.domain}`);
      console.log(`[CompetitorFinder]    - SEO Score: ${comp.seoScore}`);
      console.log(`[CompetitorFinder]    - Social Score: ${comp.socialScore}`);
      console.log(`[CompetitorFinder]    - Overall Score: ${comp.overallScore}`);
      console.log(`[CompetitorFinder]    - SEO Traffic: ${comp.seoTraffic}`);
      console.log(`[CompetitorFinder]    - Keywords: ${comp.rankedKeywords}`);
      console.log(`[CompetitorFinder]    - Entity Type: ${comp.entityType}`);
      console.log(`[CompetitorFinder]    - Genre: ${comp.detectedGenre}`);
      console.log(``);
    });

  } catch (error) {
    console.error(`[CompetitorFinder] Fatal error in competitor analysis:`, error);
    if (error instanceof Error) {
      console.error(`[CompetitorFinder] Error message: ${error.message}`);
      console.error(`[CompetitorFinder] Error stack: ${error.stack?.split('\n').slice(0, 5).join('\n')}`);
    }
    throw error;
  }

  console.log(`[CompetitorFinder] **** COMPETITOR ANALYSIS WORKFLOW COMPLETE ****`);
  console.log(`[CompetitorFinder] Total time: Started at: ${new Date().toISOString()}`);
  console.log(`[CompetitorFinder] ${"=".repeat(70)}\n`);
  
  return competitors;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
