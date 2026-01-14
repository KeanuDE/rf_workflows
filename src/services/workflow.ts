import type {
  WorkflowInput,
  WorkflowOutput,
  KeywordResult,
  KeywordData,
} from "../types";
import {
  findLocation,
  getKeywordSearchVolumeBatched,
  getSERPResults,
} from "./dataforseo";
import {
  findLocationAndGenre,
  extractKeywordsFromDescription,
  extractKeywordsFromServices,
  generateLocalSEOKeywords,
  validateKeywords,
  validateCompanyDomains,
} from "./openai";

/**
 * Haupt-Workflow Funktion
 * Entspricht dem gesamten n8n Workflow Flow
 */
export async function runSEOKeywordWorkflow(
  input: WorkflowInput
): Promise<WorkflowOutput> {
  console.log("=".repeat(60));
  console.log("Starting SEO Keyword Workflow for:", input.company_name);
  console.log("=".repeat(60));

  // Step 1: Location-Finder - Finde Standort und Branche
  console.log("\n[Step 1] Finding location and genre...");
  const locationInfo = await findLocationAndGenre(input);
  console.log("Location info:", JSON.stringify(locationInfo, null, 2));

  // Step 2: Find Location Code from DataForSEO Google Ads Locations
  // Entspricht dem "find location" Node im n8n Workflow
  console.log("\n[Step 2] Getting location code from DataForSEO...");
  let finalLocationCode = 2276; // Default: Germany
  
  try {
    // Suche mit fullLocation und filtere nach city (wie im n8n Workflow)
    const locationCode = await findLocation(locationInfo.fullLocation, locationInfo.location);
    
    if (locationCode) {
      finalLocationCode = locationCode;
      console.log("Using location code:", finalLocationCode);
    } else {
      console.warn("No specific location found, using Germany default (2276)");
    }
  } catch (error) {
    console.error("Error getting location code:", error);
    console.warn("Using Germany default (2276)");
  }

  // Step 3: Extract keywords parallel (by description AND by company purpose)
  console.log("\n[Step 3] Extracting keywords from description and services...");

  const servicesText = input.company_purpose.services
    .map((s) => `${s.name}: ${s.description}`)
    .join("\n");

  console.log("Description length:", input.description.length);
  console.log("Services text length:", servicesText.length);

  let descriptionKeywords: string[] = [];
  let serviceKeywords: string[] = [];

  try {
    [descriptionKeywords, serviceKeywords] = await Promise.all([
      extractKeywordsFromDescription(input.description, finalLocationCode),
      extractKeywordsFromServices(servicesText, finalLocationCode),
    ]);
  } catch (error) {
    console.error("Error extracting keywords:", error);
  }

  console.log("Keywords from description:", descriptionKeywords.length, descriptionKeywords.slice(0, 5));
  console.log("Keywords from services:", serviceKeywords.length, serviceKeywords.slice(0, 5));

  // Step 4: Merge and limit keywords (max 20 each, then merge)
  const limitedDescKeywords = descriptionKeywords.slice(0, 20);
  const limitedServiceKeywords = serviceKeywords.slice(0, 20);
  const mergedKeywords = [...limitedDescKeywords, ...limitedServiceKeywords];

  console.log("\n[Step 4] Merged keywords:", mergedKeywords.length);

  if (mergedKeywords.length === 0) {
    console.error("No keywords extracted! Returning empty result.");
    return {
      keywords: [],
      location: locationInfo.location,
      genre: locationInfo.genre,
    };
  }

  // Add location to each keyword (like "added location to keyword" node)
  const keywordsWithLocation = mergedKeywords.map(
    (kw) => `${kw} ${locationInfo.location}`
  );

  console.log("Keywords with location:", keywordsWithLocation.length);
  console.log("Sample:", keywordsWithLocation.slice(0, 3));

  // Step 5: Generate local SEO synonyms (Keyword searcher)
  console.log("\n[Step 5] Generating local SEO synonyms...");
  let localSEOKeywords: string[] = [];
  
  try {
    localSEOKeywords = await generateLocalSEOKeywords(
      keywordsWithLocation,
      locationInfo.genre,
      finalLocationCode
    );
    console.log("Generated", localSEOKeywords.length, "local SEO keywords");
  } catch (error) {
    console.error("Error generating local SEO keywords:", error);
  }

  // Step 6: Combine all keywords
  const allKeywords = [...keywordsWithLocation, ...localSEOKeywords];
  console.log("\n[Step 6] Total keywords before validation:", allKeywords.length);

  // Step 7: Validate keywords (Keyword validator)
  console.log("\n[Step 7] Validating keywords...");
  let validatedKeywords: string[] = [];
  
  try {
    validatedKeywords = await validateKeywords(allKeywords, locationInfo.genre);
    console.log("Validated keywords:", validatedKeywords.length);
  } catch (error) {
    console.error("Error validating keywords:", error);
    // Fallback: use all keywords if validation fails
    validatedKeywords = allKeywords;
  }

  if (validatedKeywords.length === 0) {
    console.warn("No validated keywords! Using original keywords.");
    validatedKeywords = allKeywords;
  }

  // Step 8: Get search volume for keywords (batched, max 40)
  const keywordsToCheck = validatedKeywords.slice(0, 40);
  console.log("\n[Step 8] Getting search volume for", keywordsToCheck.length, "keywords (location:", finalLocationCode, ")...");

  let keywordDataList: KeywordData[] = [];
  try {
    keywordDataList = await getKeywordSearchVolumeBatched(
      keywordsToCheck,
      finalLocationCode,
      20
    );
    console.log("Received search volume data for", keywordDataList.length, "keywords");
    
    // Debug: Zeige welche Keywords Suchvolumen haben
    const withVolume = keywordDataList.filter(k => k.search_volume && k.search_volume > 0);
    console.log(`[Step 8] Keywords with volume > 0: ${withVolume.length}`);
    if (withVolume.length > 0) {
      console.log(`[Step 8] Sample:`, withVolume.slice(0, 3).map(k => `${k.keyword}: ${k.search_volume}`));
    }
  } catch (error) {
    console.error("Error getting search volume:", error);
  }

  // Step 9: Sort by search volume and limit to top 5
  // Wenn keine Daten von DataForSEO, nutze die Keywords trotzdem
  let sortedKeywords: KeywordData[];
  
  if (keywordDataList.length > 0) {
    // Filtere nur ungültige Einträge, behalte aber Keywords mit null/0 Suchvolumen
    // (lokale Nischen-Keywords haben oft kein messbares Suchvolumen in Google Ads)
    sortedKeywords = keywordDataList
      .filter((kw) => kw && kw.keyword)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
      .slice(0, 5);
    console.log("\n[Step 9] Top keywords by volume:", sortedKeywords.length);
    
    // Warnung wenn alle Keywords kein Suchvolumen haben
    const keywordsWithVolume = sortedKeywords.filter(kw => kw.search_volume && kw.search_volume > 0);
    if (keywordsWithVolume.length === 0 && sortedKeywords.length > 0) {
      console.warn("[Step 9] Warning: No keywords have measurable search volume (common for local niche keywords)");
    }
  } else {
    // Fallback: Erstelle KeywordData ohne Search Volume
    console.warn("No search volume data available, using keywords without volume data");
    sortedKeywords = keywordsToCheck.slice(0, 5).map((kw) => ({
      keyword: kw,
      search_volume: 0,
      monthly_searches: [],
    }));
  }

  console.log("Keywords to process:", sortedKeywords.map(k => k.keyword));

  // Step 10: Get SERP results for top keywords
  console.log("\n[Step 10] Getting SERP results for top keywords...");
  const keywordResults: KeywordResult[] = [];

  // Blacklist für Vergleichsportale, Aggregatoren und überregionale Seiten
  const DOMAIN_BLACKLIST = [
    // Vergleichsportale & Aggregatoren
    "deine-heizungsmeister.de",
    "heizungsfinder.de",
    "heizung.de",
    "sanitaer.org",
    "wer-liefert-was.de",
    "wlw.de",
    "gelbeseiten.de",
    "goyellow.de",
    "11880.com",
    "dasoertliche.de",
    "meinestadt.de",
    "branchenbuch.de",
    "yelp.de",
    "yelp.com",
    "golocal.de",
    "cylex.de",
    "branchen-info.net",
    "firmenwissen.de",
    "northdata.de",
    "unternehmensregister.de",
    // Job-Portale
    "indeed.com",
    "indeed.de",
    "stepstone.de",
    "monster.de",
    "xing.com",
    "linkedin.com",
    // Bewertungsportale
    "trustpilot.com",
    "trustpilot.de",
    "kununu.com",
    "provenexpert.com",
    "ausgezeichnet.org",
    // Allgemeine Portale
    "wikipedia.org",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "twitter.com",
    "pinterest.com",
    // Handwerker-Vermittlung
    "myhammer.de",
    "check24.de",
    "homebell.com",
    "thermondo.de",
    "heizungsdiscount24.de",
    "ofenseite.com",
    "heizsparer.de",
    "energieheld.de",
    "daa.de",
    "baufoerderer.de",
    "co2online.de",
    "effizienzhaus-online.de",
    // Baumarkt-Ketten
    "obi.de",
    "hornbach.de",
    "bauhaus.info",
    "hagebau.de",
    "toom.de",
    "globus-baumarkt.de",
    // Überregionale Infoseiten
    "heizung-online.de",
    "bosy-online.de",
    "sbz-online.de",
    "ikz.de",
    "haustec.de",
  ];

  /**
   * Prüft ob eine URL zu einem Vergleichsportal oder einer überregionalen Seite gehört
   */
  function isBlacklistedDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      return DOMAIN_BLACKLIST.some(blacklisted => 
        hostname === blacklisted || hostname.endsWith("." + blacklisted)
      );
    } catch {
      return false;
    }
  }

  /**
   * Prüft ob eine URL ein typisches Aggregator-Muster hat
   * z.B. /heizung/minden oder /sanitaer/stadtname
   */
  function hasAggregatorPattern(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      // Typische Muster: /dienstleistung/stadt oder /stadt/dienstleistung
      const aggregatorPatterns = [
        /\/firmen\/[a-z-]+\/?$/,
        /\/branche\/[a-z-]+\/?$/,
        /\/region\/[a-z-]+\/?$/,
        /\/stadt\/[a-z-]+\/?$/,
        /\/[a-z-]+\/heizung\/?$/,
        /\/[a-z-]+\/sanitaer\/?$/,
        /\/[a-z-]+\/sanitär\/?$/,
      ];
      return aggregatorPatterns.some(pattern => pattern.test(pathname));
    } catch {
      return false;
    }
  }

  // Process all keywords in parallel for better performance
  const keywordPromises = sortedKeywords.map(async (keywordData, index) => {
    // Stagger requests by 500ms each to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, index * 500));
    
    console.log(`  Processing: "${keywordData.keyword}"`);
    
    try {
      const serpResponse = await getSERPResults(
        keywordData.keyword,
        finalLocationCode
      );

      const serpItems = serpResponse.tasks?.[0]?.result?.[0]?.items || [];
      console.log(`    Found ${serpItems.length} SERP results`);

      // Filter out:
      // 1. Own website
      // 2. Blacklisted domains (Vergleichsportale, Aggregatoren)
      // 3. URLs with aggregator patterns
      const preliminaryDomains = serpItems
        .filter((item) => {
          const url = item.url || "";
          
          // Eigene Website ausfiltern
          if (url.includes(input.website)) {
            return false;
          }
          
          // Blacklisted Domains ausfiltern
          if (isBlacklistedDomain(url)) {
            console.log(`    [Filtered] Blacklisted: ${url}`);
            return false;
          }
          
          // Aggregator-Pattern ausfiltern
          if (hasAggregatorPattern(url)) {
            console.log(`    [Filtered] Aggregator pattern: ${url}`);
            return false;
          }
          
          return true;
        })
        .map((item) => ({
          domain: item.url || item.domain || "",
          rank: item.rank_absolute,
        }))
        .filter((item) => item.domain !== "")
        .sort((a, b) => a.rank - b.rank);

      console.log(`    After initial filtering: ${preliminaryDomains.length} domains`);

      // Step 10b: AI-Validierung - Prüfe ob es echte Firmen sind oder Portale
      console.log(`    Validating ${preliminaryDomains.length} domains with AI...`);
      const domains = await validateCompanyDomains(preliminaryDomains);

      console.log(`    After AI validation: ${domains.length} regional competitors`);

      return {
        keyword: keywordData.keyword,
        search_volume: keywordData.search_volume || 0,
        monthly_searches: keywordData.monthly_searches || [],
        domains: domains,
      };
    } catch (error) {
      console.error(`    Error getting SERP for ${keywordData.keyword}:`, error);
      // Still include keyword without SERP data
      return {
        keyword: keywordData.keyword,
        search_volume: keywordData.search_volume || 0,
        monthly_searches: keywordData.monthly_searches || [],
        domains: [],
      };
    }
  });

  // Wait for all SERP analyses to complete
  const results = await Promise.all(keywordPromises);
  keywordResults.push(...results);

  // Final output
  const output: WorkflowOutput = {
    keywords: keywordResults,
    location: locationInfo.location,
    genre: locationInfo.genre,
  };

  console.log("\n" + "=".repeat(60));
  console.log("Workflow completed successfully");
  console.log("Total keywords in result:", keywordResults.length);
  console.log("=".repeat(60));
  
  return output;
}
