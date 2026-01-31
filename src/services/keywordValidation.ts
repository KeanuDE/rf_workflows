import OpenAI from "openai";
import type {
  KeywordQualityScore,
  SERPQualityAnalysis,
  CompetitorKeywordExtraction,
  ExpandedKeywordsResult,
  WorkflowInput,
  SERPCompetitorItem,
  KeywordData,
} from "../types";
import {
  getSERPResults,
  getKeywordSearchVolumeBatched,
  getSERPCompetitors,
} from "./dataforseo";
import { isBlacklistedDomain } from "../constants/domainBlacklist";
import { classifyCompetitorEntity, detectCustomerEntityType } from "./openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
});

const MODEL = "gpt-5-mini";
const SMALL_MODEL = "gpt-4.1-nano";

const LOCATION_CODE_GERMANY = 2276;

const QUALITY_THRESHOLDS = {
  MIN_VOLUME: 10, // Mindestens 10 monatliche Suchen
  MIN_TOTAL_SCORE: 60, // Mindestscore für "qualifiziertes" Keyword
};

const SCORE_WEIGHTS = {
  SEARCH_VOLUME: 30,
  SERP_QUALITY: 30,
  DIFFICULTY: 20,
  RELEVANCE: 20,
};

export async function validateKeywordsQuality(
  keywords: string[],
  locationCode: number,
  customerGenre: string,
  input: WorkflowInput
): Promise<KeywordQualityScore[]> {
  console.log(`[KeywordValidation] Validating top ${Math.min(keywords.length, 20)} keywords for quality...`);

  const results: KeywordQualityScore[] = [];
  const topKeywords = keywords.slice(0, 20);

  for (const keyword of topKeywords) {
    try {
      const score = await scoreKeyword(keyword, locationCode, customerGenre, input);
      results.push(score);
    } catch (error) {
      console.error(`[KeywordValidation] Error scoring "${keyword}":`, error);
      results.push(createFailedScore(keyword, ["Validation error"]));
    }
  }

  const validCount = results.filter((r) => r.isValid).length;
  console.log(`[KeywordValidation] ${validCount}/${results.length} keywords passed quality check (score >= ${QUALITY_THRESHOLDS.MIN_TOTAL_SCORE})`);

  return results;
}

async function scoreKeyword(
  keyword: string,
  locationCode: number,
  customerGenre: string,
  input: WorkflowInput
): Promise<KeywordQualityScore> {
  console.log(`[KeywordValidation] Scoring: "${keyword}"`);

  const reasons: string[] = [];

  try {
    const [serpAnalysis, volumeData] = await Promise.all([
      analyzeSERPQuality(keyword, locationCode),
      getKeywordSearchVolumeBatched([keyword],	locationCode, 1),
    ]);

    const volumeDataItem = volumeData[0] || { search_volume: 0, competition: "unknown" };
    const searchVolume = volumeDataItem.search_volume || 0;
    const competition = volumeDataItem.competition || "unknown";

    const volumeScore = calculateVolumeScore(searchVolume);
    const serpScore = serpAnalysis.qualityScore;
    const difficultyScore = calculateDifficultyScore(competition);
    const relevanceScore = await calculateRelevanceScore(keyword, customerGenre);

    const totalScore = Math.round(
      volumeScore + serpScore + difficultyScore + relevanceScore
    );

    const isValid = totalScore >= QUALITY_THRESHOLDS.MIN_TOTAL_SCORE;

    if (searchVolume < QUALITY_THRESHOLDS.MIN_VOLUME) {
      reasons.push(`Low search volume (${searchVolume} < ${QUALITY_THRESHOLDS.MIN_VOLUME})`);
    }
    if (serpScore < 15) {
      reasons.push(`Poor SERP quality (mostly portals/shops)`);
    }
    if (serpAnalysis.domainTypes.portals > serpAnalysis.domainTypes.companies) {
      reasons.push(`More portals than genuine companies`);
    }

    if (isValid) {
      reasons.push(`Good: Score ${totalScore} >= ${QUALITY_THRESHOLDS.MIN_TOTAL_SCORE}`);
    }

    return {
      keyword,
      isValid,
      qualityScore: totalScore,
      reasons,
      searchVolumeScore: volumeScore,
      serpQualityScore: serpScore,
      difficultyScore,
      relevanceScore,
      searchVolume,
      competition,
      competitorCount: serpAnalysis.competitorCount,
      avgCompetitorRank: serpAnalysis.avgCompetitorRank,
    };
  } catch (error) {
    console.error(`[KeywordValidation] Scoring error for "${keyword}":`, error);
    return createFailedScore(keyword, ["Scoring failed"]);
  }
}

function calculateVolumeScore(searchVolume: number): number {
  if (searchVolume === 0) return 0;
  if (searchVolume < 10) return 5;
  if (searchVolume < 50) return 10;
  if (searchVolume < 100) return 15;
  if (searchVolume < 500) return 20;
  if (searchVolume < 1000) return 25;
  return 30;
}

function calculateDifficultyScore(competition: string): number {
  switch (competition) {
    case "low": return 20;
    case "medium": return 15;
    case "high": return 10;
    default: return 5;
  }
}

async function calculateRelevanceScore(
  keyword: string,
  customerGenre: string
): Promise<number> {
  const transactionalPatterns = [
    /buchen/i,
    /beauftragen/i,
    /bestellen/i,
    /anfrage/i,
    /angebot/i,
    /kosten/i,
    /preis/i,
    /firma/i,
    /betrieb/i,
    /service/i,
    /dienstleister/i,
    /machen lassen/i,
    /in der nähe/i,
    /kontakt/i,
  ];

  let score = 0;

  for (const pattern of transactionalPatterns) {
    if (pattern.test(keyword)) {
      score += 10;
      break;
    }
  }

  if (keyword.toLowerCase().includes(customerGenre.toLowerCase())) {
    score += 5;
  }

  return Math.min(score, 20);
}

function createFailedScore(keyword: string, extraReasons: string[]): KeywordQualityScore {
  return {
    keyword,
    isValid: false,
    qualityScore: 0,
    reasons: ["Validation failed", ...extraReasons],
    searchVolumeScore: 0,
    serpQualityScore: 0,
    difficultyScore: 0,
    relevanceScore: 0,
    searchVolume: 0,
    competition: "unknown",
    competitorCount: 0,
    avgCompetitorRank: 0,
  };
}

export async function analyzeSERPQuality(
  keyword: string,
  locationCode: number
): Promise<SERPQualityAnalysis> {
  console.log(`[SERPQuality] Analyzing: "${keyword}"`);

  try {
    const serpResponse = await getSERPResults(keyword, locationCode);
    const serpItems = serpResponse.tasks?.[0]?.result?.[0]?.items || [];

    if (serpItems.length === 0) {
      return {
        keyword,
        competitorCount: 0,
        avgCompetitorRank: 0,
        domainTypes: { companies: 0, portals: 0, shops: 0, other: 0 },
        hasLocalResults: false,
        qualityScore: 0,
      };
    }

    console.log(`[SERPQuality] Found ${serpItems.length} SERP results`);

    const top3Items = serpItems.slice(0, 3);
    const domainTypes = { companies: 0, portals: 0, shops: 0, other: 0 };

    let totalRank = 0;
    let localCount = 0;

    for (const item of top3Items) {
      const url = item.url || item.domain || "";
      totalRank += item.rank_absolute || 0;

      try {
        const classified = await isServiceBusinessDomain(url);
        if (classified === "company") {
          domainTypes.companies++;
          if (isLocalDomain(url)) {
            localCount++;
          }
        } else if (classified === "portal") {
          domainTypes.portals++;
        } else if (classified === "shop") {
          domainTypes.shops++;
        } else {
          domainTypes.other++;
        }
      } catch {
        domainTypes.other++;
      }
    }

    const avgRank = totalRank / Math.max(top3Items.length, 1);

    const qualityScore = Math.round(
      (domainTypes.companies * 10) -
      (domainTypes.portals * 15) -
      (domainTypes.shops * 5) +
      (localCount >= 2 ? 10 : 0)
    );

    return {
      keyword,
      competitorCount: top3Items.length,
      avgCompetitorRank: Math.round(avgRank),
      domainTypes,
      hasLocalResults: localCount >= 2,
      qualityScore: Math.max(0, Math.min(100, qualityScore)),
    };
  } catch (error) {
    console.error(`[SERPQuality] Error:`, error);
    return {
      keyword,
      competitorCount: 0,
      avgCompetitorRank: 0,
      domainTypes: { companies: 0, portals: 0, shops: 0, other: 0 },
      hasLocalResults: false,
      qualityScore: 0,
    };
  }
}

async function isServiceBusinessDomain(url: string): Promise<"company" | "portal" | "shop" | "other"> {
  try {
    // Erst zentrale Blacklist prüfen - diese hat Vorrang
    if (isBlacklistedDomain(url)) {
      return "portal";
    }

    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");

    const companyPatterns = [
      /^[a-z-]+\.(de|com|net|org)$/,
      /\.(heizung|sanitaer|klempner|installation|bau|handwerk|gbr|gmbh)/i,
    ];

    const portalPatterns = [
      /finder$/,
      /vergleich$/,
      /test$/,
      /check$/,
      /guide$/,
      /-[a-z]+-in-/,
      /(check24|myhammer|wer-liefert-was|gelbeseiten|yelp|jameda)/i,
    ];

    const shopPatterns = [
      /shop$/,
      /store$/,
      /markt$/,
      /handel$/,
      /(amazon|ebay|otto|hornbach|obi|bauhaus)/i,
    ];

    for (const pattern of shopPatterns) {
      if (pattern.test(hostname)) return "shop";
    }

    for (const pattern of portalPatterns) {
      if (pattern.test(hostname)) return "portal";
    }

    for (const pattern of companyPatterns) {
      if (pattern.test(hostname)) return "company";
    }

    const pathPatterns = [
      /\/(impressum|kontakt|uber-uns|unternehmen|firma)\//i,
      /\/services?|leistungen|arbeiten?\//i,
    ];

    const pathname = new URL(url).pathname.toLowerCase();
    for (const pattern of pathPatterns) {
      if (pattern.test(pathname)) return "company";
    }

    return "other";
  } catch {
    return "other";
  }
}

function isLocalDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const deTLD = hostname.endsWith(".de") || hostname.includes(".de.");
    return deTLD;
  } catch {
    return false;
  }
}

export function filterKeywordsByScore(
  scoredKeywords: KeywordQualityScore[],
  minScore: number = 60
): KeywordQualityScore[] {
  return scoredKeywords.filter((k) => k.qualityScore >= minScore);
}

export function duplicateFilter(
  keywords: string[],
  similarityThreshold: number = 0.85
): string[] {
  const unique: string[] = [];
  const seenSignatures = new Map<string, string>();

  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    const words = normalized.split(/\s+/).sort().join(' ');
    const signature = words;

    let isDuplicate = false;
    
    if (seenSignatures.has(signature)) {
      isDuplicate = true;
    } else {
      for (const [existingSig, existingKw] of seenSignatures) {
        const existingWords = existingSig.split(' ');
        const currentWords = signature.split(' ');
        
        if (existingWords.length === 0 || currentWords.length === 0) continue;

        const intersection = currentWords.filter((w) => existingWords.includes(w)).length;
        const union = new Set([...currentWords, ...existingWords]).size;

        if (union > 0) {
          const similarity = intersection / union;
          if (similarity >= similarityThreshold) {
            isDuplicate = true;
            break;
          }
        }
      }
    }

    if (!isDuplicate) {
      unique.push(keyword);
      seenSignatures.set(signature, keyword);
    }
  }

  console.log(`[KeywordValidation] Filtered ${keywords.length - unique.length} duplicates`);
  return unique;
}

export async function extractCompetitorKeywords(
  competitors: SERPCompetitorItem[],
  locationCode: number,
  customerGenre: string,
  limit: number = 20
): Promise<CompetitorKeywordExtraction> {
  console.log(`[CompetitorKeywords] Extracting keywords from ${competitors.length} competitors...`);

  if (competitors.length === 0) {
    return { keywords: [], topKeywords: [] };
  }

  const keywords: CompetitorKeywordExtraction["keywords"] = [];

  for (const competitor of competitors.slice(0, 10)) {
    const organic = competitor.full_domain_metrics?.organic;
    if (!organic || organic.count === 0) continue;

    const etv = organic.etv || 0;
    const avgPosition = competitor.avg_position || 0;

    keywords.push({
      keyword: competitor.domain,
      searchVolume: Math.round(etv),
      avgPosition: Math.round(avgPosition),
      competitorCount: organic.count,
    });
  }

  keywords.sort((a, b) => b.searchVolume - a.searchVolume);

  const topKeywords = keywords
    .slice(0, limit)
    .map((k) => k.keyword);

  console.log(`[CompetitorKeywords] Extracted ${keywords.length} competitor keywords (top ${topKeywords.length} by volume)`);

  return { keywords, topKeywords };
}

export async function expandKeywordsWithVolume(
  generatedKeywords: string[],
  topCompetitorKeywords: string[],
  customerGenre: string,
  input: WorkflowInput,
  locationCode: number
): Promise<ExpandedKeywordsResult> {
  console.log(`[KeywordExpansion] Expanding keywords with volume data...`);

  try {
    const allKeywords = [...generatedKeywords, ...topCompetitorKeywords];
    const uniqueKeywords = duplicateFilter(allKeywords);

    console.log(`[KeywordExpansion] Volume check for ${uniqueKeywords.length} unique keywords...`);

    const volumeDataList = await getKeywordSearchVolumeBatched(
      uniqueKeywords,
      locationCode,
      20
    );

    const withVolume = volumeDataList
      .filter((kd) => kd.search_volume && kd.search_volume >= QUALITY_THRESHOLDS.MIN_VOLUME)
      .filter((kd) => kd.keyword)
      .map((kd) => ({
        keyword: kd.keyword,
        volume: kd.search_volume || 0,
        competition: kd.competition || "unknown",
      }))
      .sort((a, b) => b.volume - a.volume);

    console.log(`[KeywordExpansion] ${withVolume.length}/${uniqueKeywords.length} keywords have volume >= ${QUALITY_THRESHOLDS.MIN_VOLUME}`);

    const combined = withVolume.map((k) => k.keyword);

    const highVolume = combined.filter((kw) => {
      const volData = withVolume.find((w) => w.keyword === kw);
      return volData && volData.volume >= 50;
    });

    console.log(`[KeywordExpansion] ${highVolume.length} high-volume keywords (>= 50 monthly searches)`);

    return {
      generated: generatedKeywords,
      competitorKeywords: topCompetitorKeywords,
      combined,
      highVolume,
    };
  } catch (error) {
    console.error("[KeywordExpansion] Error:", error);
    return {
      generated: generatedKeywords,
      competitorKeywords: topCompetitorKeywords,
      combined: [...generatedKeywords, ...topCompetitorKeywords],
      highVolume: [],
    };
  }
}

export function logKeywordValidation(results: KeywordQualityScore[]): void {
  console.log("\n" + "=".repeat(60));
  console.log("KEYWORD VALIDATION REPORT");
  console.log("=".repeat(60));

  const valid = results.filter((r) => r.isValid);
  const invalid = results.filter((r) => !r.isValid);

  console.log(`\nTotal: ${results.length} keywords`);
  console.log(`  ✓ Valid: ${valid.length} (${Math.round((valid.length / results.length) * 100)}%)`);
  console.log(`  ✗ Invalid: ${invalid.length} (${Math.round((invalid.length / results.length) * 100)}%)`);

  if (valid.length > 0) {
    console.log("\nTop 10 Valid Keywords:");
    valid
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 10)
      .forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.keyword} - Score: ${r.qualityScore} (Vol: ${r.searchVolume}, SERP: ${r.serpQualityScore})`);
      });
  }

  if (invalid.length > 0) {
    console.log("\nSample Invalid Keywords:");
    invalid
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.keyword} - ${r.reasons[0]}`);
      });
  }

  console.log("\n" + "=".repeat(60));
}