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
  generateIntentKeywords,
  selectTopKeywordsForSERP,
  type IntentKeywordInput,
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
  
  if (input.operating_region === "regional") {
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
  } else {
    console.log(`Operating region is '${input.operating_region || "undefined"}' (not 'regional'). Using Germany default (2276).`);
  }

  // Step 3: Generate Intent-based Keywords (Neudesign: "Suchintention aus Kundensicht")
  // Ersetzt die alte Extraktion + Synonym-Generierung durch einen einzigen Intent-Generator
  console.log("\n[Step 3] Generating intent-based keywords (user search perspective)...");

  const servicesText = input.company_purpose.services
    .map((s) => `${s.name}: ${s.description}`)
    .join("\n");

  const intentInput: IntentKeywordInput = {
    company_name: input.company_name,
    industry: input.industry,
    industry_subcategory: input.industry_subcategory,
    custom_subcategory: input.custom_subcategory,
    description: `${input.description}\n\nServices:\n${servicesText}`,
    company_purpose: input.company_purpose.description,
    location: locationInfo.location,
    operating_region: input.operating_region || "regional",
  };

  let validatedKeywords: string[] = [];

  try {
    const intentResult = await generateIntentKeywords(intentInput);
    
    console.log(`[Step 3] Generated ${intentResult.keywords.length} intent keywords`);
    if (intentResult.clusters && intentResult.clusters.length > 0) {
      console.log(`[Step 3] Clusters: ${intentResult.clusters.map(c => c.name).join(", ")}`);
    }

    // Wähle die besten 8-12 Keywords für SERP/Wettbewerber-Analyse
    // (Prompt erzeugt 30, aber für Competitors brauchen wir fokussierte Auswahl)
    validatedKeywords = selectTopKeywordsForSERP(intentResult, 12);
    
    console.log(`[Step 3] Selected ${validatedKeywords.length} top keywords for SERP analysis`);
    console.log(`[Step 3] Sample:`, validatedKeywords.slice(0, 5));

  } catch (error) {
    console.error("Error generating intent keywords:", error);
    
    // Fallback: Alte Methode verwenden
    console.log("[Step 3] Falling back to legacy keyword extraction...");
    
    let descriptionKeywords: string[] = [];
    let serviceKeywords: string[] = [];

    try {
      [descriptionKeywords, serviceKeywords] = await Promise.all([
        extractKeywordsFromDescription(input.description, finalLocationCode),
        extractKeywordsFromServices(servicesText, finalLocationCode),
      ]);
    } catch (fallbackError) {
      console.error("Fallback extraction also failed:", fallbackError);
    }

    const mergedKeywords = [...descriptionKeywords.slice(0, 20), ...serviceKeywords.slice(0, 20)];
    
    // Add location to each keyword ONLY if regional (legacy behavior)
    const isRegional = input.operating_region === "regional";
    validatedKeywords = isRegional
      ? mergedKeywords.map((kw) => `${kw} ${locationInfo.location}`)
      : mergedKeywords;
  }

  if (validatedKeywords.length === 0) {
    console.error("No keywords generated! Returning empty result.");
    return {
      keywords: [],
      location: locationInfo.location,
      genre: locationInfo.genre,
    };
  }

  // Step 4: Get search volume for keywords (batched, max 40)
  const keywordsToCheck = validatedKeywords.slice(0, 50);
  console.log("\n[Step 4] Getting search volume for", keywordsToCheck.length, "keywords (location:", finalLocationCode, ")...");

  let keywordDataList: KeywordData[] = [];
  try {
    keywordDataList = await getKeywordSearchVolumeBatched(
      keywordsToCheck,
      finalLocationCode,
      50
    );
    console.log("Received search volume data for", keywordDataList.length, "keywords");
    
    // Debug: Zeige welche Keywords Suchvolumen haben
    const withVolume = keywordDataList.filter(k => k.search_volume && k.search_volume > 0);
    console.log(`[Step 4] Keywords with volume > 0: ${withVolume.length}`);
    if (withVolume.length > 0) {
      console.log(`[Step 4] Sample:`, withVolume.slice(0, 3).map(k => `${k.keyword}: ${k.search_volume}`));
    }
  } catch (error) {
    console.error("Error getting search volume:", error);
  }

  // Step 5: Sort by search volume and limit to top 50
  // Wenn keine Daten von DataForSEO, nutze die Keywords trotzdem
  let sortedKeywords: KeywordData[];
  
  if (keywordDataList.length > 0) {
    // Filtere nur ungültige Einträge, behalte aber Keywords mit null/0 Suchvolumen
    // (lokale Nischen-Keywords haben oft kein messbares Suchvolumen in Google Ads)
    sortedKeywords = keywordDataList
      .filter((kw) => kw && kw.keyword)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
      .slice(0, 50);
    console.log("\n[Step 5] Top keywords by volume:", sortedKeywords.length);
    
    // Warnung wenn alle Keywords kein Suchvolumen haben
    const keywordsWithVolume = sortedKeywords.filter(kw => kw.search_volume && kw.search_volume > 0);
    if (keywordsWithVolume.length === 0 && sortedKeywords.length > 0) {
      console.warn("[Step 5] Warning: No keywords have measurable search volume (common for local niche keywords)");
    }
  } else {
    // Fallback: Erstelle KeywordData ohne Search Volume
    console.warn("No search volume data available, using keywords without volume data");
    sortedKeywords = keywordsToCheck.slice(0, 50).map((kw) => ({
      keyword: kw,
      search_volume: 0,
      monthly_searches: [],
    }));
  }

  console.log("Keywords to process:", sortedKeywords.map(k => k.keyword));

  // Step 6: Get SERP results for top keywords
  console.log("\n[Step 6] Getting SERP results for top keywords...");
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
