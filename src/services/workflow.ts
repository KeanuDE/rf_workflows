import type {
  WorkflowInput,
  WorkflowOutput,
  KeywordResult,
  KeywordData,
  EntityType,
} from "../types";
import {
  findLocation,
  getKeywordSearchVolumeBatched,
  getSERPResults,
} from "./dataforseo";
import {
  findLocationAndGenre,
  findLocationViaGoogleSearch,
  extractKeywordsFromDescription,
  extractKeywordsFromServices,
  generateIntentKeywords,
  selectTopKeywordsForSERP,
  validateCompanyDomains,
  detectCustomerEntityType,
  type IntentKeywordInput,
} from "./openai";
import { findAndAnalyzeCompetitors } from "./competitorFinder";
import {
  isBlacklistedDomain,
  hasAggregatorPattern,
} from "../constants/domainBlacklist";
import {
  validateKeywordsQuality,
  filterKeywordsByScore,
  duplicateFilter,
  extractCompetitorKeywords,
  expandKeywordsWithVolume,
  logKeywordValidation,
} from "./keywordValidation";

const GERMANY_LOCATION_CODE = 2276;
const SERP_RATE_LIMIT_MS = 500;

async function findLocationCode(
  fullLocation: string,
  city: string,
  operatingRegion: string
): Promise<number> {
  if (operatingRegion !== "regional") {
    console.log(`Using Germany default for non-regional operating region`);
    return GERMANY_LOCATION_CODE;
  }

  try {
    const locationCode = await findLocation(fullLocation, city);
    if (locationCode) {
      console.log("Using location code:", locationCode);
      return locationCode;
    }
    console.warn("No specific location found, using Germany default");
  } catch (error) {
    console.error("Error getting location code:", error);
  }
  return GERMANY_LOCATION_CODE;
}

async function generateKeywords(
  input: WorkflowInput,
  locationInfo: { location: string },
  locationCode: number
): Promise<string[]> {
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

  try {
    const intentResult = await generateIntentKeywords(intentInput);
    console.log(`Generated ${intentResult.keywords.length} intent keywords`);
    const keywords = selectTopKeywordsForSERP(intentResult, 50);
    console.log(`Selected ${keywords.length} top keywords for SERP analysis`);
    return keywords;
  } catch (error) {
    console.error("Error generating intent keywords:", error);
    console.log("Falling back to legacy keyword extraction...");
    return legacyKeywordExtraction(input, locationCode, locationInfo.location);
  }
}

async function legacyKeywordExtraction(
  input: WorkflowInput,
  locationCode: number,
  location: string
): Promise<string[]> {
  const servicesText = input.company_purpose.services
    .map((s) => `${s.name}: ${s.description}`)
    .join("\n");

  try {
    const [descriptionKeywords, serviceKeywords] = await Promise.all([
      extractKeywordsFromDescription(input.description, locationCode),
      extractKeywordsFromServices(servicesText, locationCode),
    ]);

    const mergedKeywords = [...descriptionKeywords.slice(0, 20), ...serviceKeywords.slice(0, 20)];
    const isRegional = input.operating_region === "regional";
    return isRegional
      ? mergedKeywords.map((kw) => `${kw} ${location}`)
      : mergedKeywords;
  } catch (fallbackError) {
    console.error("Fallback extraction also failed:", fallbackError);
    return [];
  }
}

async function getSearchVolume(keywords: string[], locationCode: number): Promise<KeywordData[]> {
  try {
    const keywordDataList = await getKeywordSearchVolumeBatched(keywords, locationCode, 50);
    console.log("Received search volume data for", keywordDataList.length, "keywords");
    return keywordDataList;
  } catch (error) {
    console.error("Error getting search volume:", error);
    return [];
  }
}

function sortKeywords(keywordDataList: KeywordData[], keywordsToCheck: string[]): KeywordData[] {
  if (keywordDataList.length > 0) {
    return keywordDataList
      .filter((kw) => kw && kw.keyword)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
      .slice(0, 50);
  }

  return keywordsToCheck.slice(0, 50).map((kw) => ({
    keyword: kw,
    search_volume: 0,
    monthly_searches: [],
  }));
}

interface SERPItem {
  url?: string;
  domain?: string;
  rank_absolute?: number;
}

function filterValidDomains(
  items: SERPItem[],
  ownWebsite: string
): Array<{ domain: string; rank: number }> {
  return items
    .filter((item) => {
      const url = item.url || "";
      if (url.includes(ownWebsite)) return false;
      if (isBlacklistedDomain(url)) {
        console.log(`    [Filtered] Blacklisted: ${url}`);
        return false;
      }
      if (hasAggregatorPattern(url)) {
        console.log(`    [Filtered] Aggregator pattern: ${url}`);
        return false;
      }
      return true;
    })
    .map((item) => ({
      domain: item.url || item.domain || "",
      rank: item.rank_absolute || 0,
    }))
    .filter((item) => item.domain !== "")
    .sort((a, b) => a.rank - b.rank);
}

function calculateSERPScore(keywordResult: KeywordResult): number {
  const competitorCount = keywordResult.domains.length;

  if (competitorCount === 0) {
    return 0;
  }

  const topCompetitor = keywordResult.domains[0];
  const rankScore = Math.max(0, (10 - (topCompetitor?.rank ?? 11)) / 10) * 50;
  const competitorScore = Math.min(competitorCount, 10) * 5;

  return Math.round(rankScore + competitorScore);
}

async function processSERPKeyword(
  keywordData: KeywordData,
  locationCode: number,
  ownWebsite: string
): Promise<KeywordResult> {
  await new Promise((resolve) => setTimeout(resolve, SERP_RATE_LIMIT_MS));
  console.log(`  Processing: "${keywordData.keyword}"`);

  try {
    const serpResponse = await getSERPResults(keywordData.keyword, locationCode);
    const serpItems = serpResponse.tasks?.[0]?.result?.[0]?.items || [];
    console.log(`    Found ${serpItems.length} SERP results`);

    const preliminaryDomains = filterValidDomains(serpItems, ownWebsite);
    console.log(`    After initial filtering: ${preliminaryDomains.length} domains`);

    console.log(`    Validating ${preliminaryDomains.length} domains with AI...`);
    const domains = await validateCompanyDomains(preliminaryDomains);
    console.log(`    After AI validation: ${domains.length} regional competitors`);

    const result = {
      keyword: keywordData.keyword,
      search_volume: keywordData.search_volume || 0,
      monthly_searches: keywordData.monthly_searches || [],
      domains: domains,
      serpScore: 0,
    };

    result.serpScore = calculateSERPScore(result);
    console.log(`    SERP Score: ${result.serpScore} (rank: ${result.search_volume || 0})`);

    return result;
  } catch (error) {
    console.error(`    Error getting SERP for ${keywordData.keyword}:`, error);
    return {
      keyword: keywordData.keyword,
      search_volume: keywordData.search_volume || 0,
      monthly_searches: keywordData.monthly_searches || [],
      domains: [],
      serpScore: 0,
    };
  }
}

export async function runSEOKeywordWorkflow(
  input: WorkflowInput
): Promise<WorkflowOutput> {
  console.log("=".repeat(60));
  console.log("Starting SEO Keyword Workflow for:", input.company_name);
  console.log("=".repeat(60));

  console.log("\n[Step 1] Finding location and genre...");
  let locationInfo = await findLocationAndGenre(input);
  console.log("Location info:", JSON.stringify(locationInfo, null, 2));

  // Fallback: Wenn Location ODER Genre fehlt, Google-Suche starten
  const locationMissing = !locationInfo.location?.trim();
  const genreMissing = !locationInfo.genre?.trim();
  
  if (locationMissing || genreMissing) {
    console.log(`\n[Step 1b] Fallback needed - Location missing: ${locationMissing}, Genre missing: ${genreMissing}`);
    console.log("[Step 1b] Starting Google search fallback with Firecrawl...");
    
    try {
      const fallbackResult = await findLocationViaGoogleSearch(
        input.company_name,
        input.website
      );
      
      if (fallbackResult) {
        // Merge: Nur fehlende Werte überschreiben
        locationInfo = {
          location: locationInfo.location?.trim() || fallbackResult.location || "",
          fullLocation: locationInfo.fullLocation?.trim() || fallbackResult.fullLocation || "",
          genre: locationInfo.genre?.trim() || fallbackResult.genre || "",
          entityType: locationInfo.entityType,
        };
        console.log("[Step 1b] Fallback result merged:", JSON.stringify(locationInfo, null, 2));
      } else {
        console.warn("[Step 1b] Fallback search returned no results");
      }
    } catch (error) {
      console.error("[Step 1b] Fallback search failed:", error);
    }
    
    // Letzte Chance: input.location verwenden wenn vorhanden
    if (!locationInfo.location?.trim() && input.location?.trim()) {
      console.log(`[Step 1b] Using input.location as last resort: "${input.location}"`);
      locationInfo.location = input.location;
      locationInfo.fullLocation = input.location;
    }
  }

  console.log("\n[Step 2] Getting location code from DataForSEO...");
  const finalLocationCode = await findLocationCode(
    locationInfo.fullLocation,
    locationInfo.location,
    input.operating_region || "regional"
  );

  console.log("\n[Step 3] Generating intent-based keywords...");
  const generatedKeywords = await generateKeywords(input, locationInfo, finalLocationCode);

  if (generatedKeywords.length === 0) {
    console.error("No keywords generated! Returning empty result.");
    return { keywords: [], location: locationInfo.location, genre: locationInfo.genre };
  }

  console.log("\n[Step 4] Quality Validation Pipeline...");
  
  let keywordResults: any = [];

  try {
    const qualityScores = await validateKeywordsQuality(
      generatedKeywords.slice(0, 50),
      finalLocationCode,
      locationInfo.genre,
      input
    );

    logKeywordValidation(qualityScores);

    const validKeywords = filterKeywordsByScore(qualityScores, 60);
    console.log(`[Step 4] ${validKeywords.length}/${qualityScores.length} keywords passed quality check (score >= 60)`);

    if (validKeywords.length < 10) {
      console.warn("[Step 4] Not enough valid keywords, using fallback strategy");
    }

    const keywordsToCheck = validKeywords.map((k) => k.keyword).slice(0, 30);
    const keywordsToCheckFallback = qualityScores.slice(0, 30).map((k) => k.keyword);

    const finalKeywordsToCheck = keywordsToCheck.length < 10 ? keywordsToCheckFallback : keywordsToCheck;
    console.log(`[Step 4] Using ${finalKeywordsToCheck.length} keywords for SERP analysis`);

    console.log("\n[Step 5] Getting search volume for", finalKeywordsToCheck.length, "keywords...");

    const keywordDataList = await getSearchVolume(finalKeywordsToCheck, finalLocationCode);
    const sortedKeywords = sortKeywords(keywordDataList, finalKeywordsToCheck);

    console.log("\n[Step 6] Getting SERP results for top keywords...");
    keywordResults = await Promise.all(
      sortedKeywords.map((kw) => processSERPKeyword(kw, finalLocationCode, input.website))
    );

  } catch (error) {
    console.error("[Step 4] Quality validation failed, using default keywords:", error);
    
    const keywordsToCheck = generatedKeywords.slice(0, 50);
    console.log("\n[Step 5] Getting search volume for", keywordsToCheck.length, "keywords...");

    const keywordDataList = await getSearchVolume(keywordsToCheck, finalLocationCode);
    const sortedKeywords = sortKeywords(keywordDataList, keywordsToCheck);

    console.log("\n[Step 6] Getting SERP results for top keywords...");
    keywordResults = await Promise.all(
      sortedKeywords.map((kw) => processSERPKeyword(kw, finalLocationCode, input.website))
    );
  }

  let competitors = undefined;
  
  try {
    const websiteContent = input.description || "";
    const customerEntityType: EntityType = await detectCustomerEntityType(
      websiteContent,
      input.description
    );
    console.log(`Customer entity type: ${customerEntityType}`);

    competitors = await findAndAnalyzeCompetitors(
      generatedKeywords.slice(0, 50),
      input.website,
      locationInfo.genre,
      customerEntityType,
      input.operating_region || "regional",
      locationInfo.location,
      locationInfo.fullLocation,
      15
    );

    console.log(`Found ${competitors.length} relevant competitors`);
  } catch (error) {
    console.error("[Step 7] Competitor analysis failed:", error);
  }

  const output: WorkflowOutput = {
    keywords: keywordResults,
    location: locationInfo.location,
    genre: locationInfo.genre,
    competitors: competitors,
  };

  console.log("\n" + "=".repeat(60));
  console.log("Workflow completed successfully");
  console.log("Total keywords in result:", keywordResults.length);
  console.log("=".repeat(60));
  
  return output;
}
