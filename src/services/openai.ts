import OpenAI from "openai";
import type {
  LocationFinderOutput,
  WorkflowInput,
  CrawlerInput,
  CrawlerOutput,
  EntityClassification,
  EntityType,
} from "../types";
import { crawlWebsite, crawlWebsiteLightweight } from "./crawler";
import { getSERPResults } from "./dataforseo";
import { violatesHardFilter, INTENT_HARD_FILTERS } from "../constants/intentHardFilters";

function applyHardFilters(keywords: string[]): string[] {
  return keywords.filter(kw => {
    if (violatesHardFilter(kw)) {
      console.log(`[IntentKeywords] Hard-filtered: "${kw}"`);
      return false;
    }
    return true;
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
});

const MODEL = "gpt-5-mini";
const SMALL_MODEL = "gpt-4.1-nano"
/**
 * Tool Definition für Keyword-Validierung via SERP
 * Entspricht dem "keywordtool" im n8n Workflow
 * Nutzt /serp/google/organic/live/regular
 */
const checkKeywordTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "check_keyword",
    description: "Prüft ein Keyword bei Google um zu sehen ob es Suchergebnisse gibt und wie relevant es ist. Gibt die Anzahl der Ergebnisse und Top-Rankings zurück.",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Das Keyword das geprüft werden soll",
        },
      },
      required: ["keyword"],
    },
  },
};

/**
 * Speicher für den Agent - merkt sich bereits geprüfte Keywords
 */
interface AgentMemory {
  checkedKeywords: Map<string, boolean>; // keyword -> has_results
  goodKeywords: string[]; // Keywords mit SERP-Ergebnissen
  locationCode: number;
}

/**
 * Führt das SERP-Tool aus
 * Entspricht dem "keywordtool" Workflow in n8n
 * Nutzt /serp/google/organic/live/regular
 */
async function executeKeywordTool(
  keyword: string,
  memory: AgentMemory
): Promise<string> {
  // Prüfe ob Keyword bereits gecheckt wurde
  const keywordLower = keyword.toLowerCase();
  if (memory.checkedKeywords.has(keywordLower)) {
    const hasResults = memory.checkedKeywords.get(keywordLower);
    return JSON.stringify({
      keyword,
      cached: true,
      has_results: hasResults,
      message: hasResults ? "Keyword hat Suchergebnisse (aus Cache)" : "Keyword hat keine Suchergebnisse (aus Cache)",
    });
  }

  try {
    console.log(`[Agent Tool] Checking SERP for keyword: "${keyword}"`);
    
    const serpResponse = await getSERPResults(keyword, memory.locationCode);
    const items = serpResponse.tasks?.[0]?.result?.[0]?.items || [];
    
    const hasResults = items.length > 0;
    
    // Speichere im Memory
    memory.checkedKeywords.set(keywordLower, hasResults);
    if (hasResults) {
      memory.goodKeywords.push(keyword);
    }
    
    // Formatiere die Ergebnisse für den Agent
    const topResults = items.slice(0, 3).map((item, index) => ({
      rank: index + 1,
      domain: item.domain || (item.url ? new URL(item.url).hostname : "unknown"),
    }));
    
    return JSON.stringify({
      keyword,
      has_results: hasResults,
      result_count: items.length,
      top_domains: topResults,
      recommendation: hasResults 
        ? "Keyword ist gut - hat Suchergebnisse bei Google" 
        : "Keyword vermeiden - keine Suchergebnisse",
    });
  } catch (error) {
    console.error(`[Agent Tool] Error checking keyword "${keyword}":`, error);
    // Bei Fehler trotzdem als "gut" markieren um den Flow nicht zu blockieren
    memory.checkedKeywords.set(keywordLower, true);
    memory.goodKeywords.push(keyword);
    return JSON.stringify({
      keyword,
      error: "Konnte Keyword nicht prüfen - wird trotzdem verwendet",
      has_results: true,
    });
  }
}

/**
 * Verarbeitet Tool-Calls vom Agent
 */
async function processToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  memory: AgentMemory
): Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam[]> {
  const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];
  
  for (const toolCall of toolCalls) {
    if (toolCall.type === "function" && "function" in toolCall) {
      const functionCall = toolCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
      
      if (functionCall.function.name === "check_keyword") {
        const args = JSON.parse(functionCall.function.arguments);
        const result = await executeKeywordTool(args.keyword, memory);
        
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }
  }
  
  return toolResults;
}

/**
 * Führt einen Agent mit Tool-Unterstützung und Memory aus
 */
async function runKeywordAgent(
  systemPrompt: string,
  userPrompt: string,
  locationCode: number,
  maxIterations: number = 10
): Promise<string[]> {
  const memory: AgentMemory = {
    checkedKeywords: new Map(),
    goodKeywords: [],
    locationCode,
  };

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let iterations = 0;
  
  while (iterations < maxIterations) {
    iterations++;
    console.log(`[Agent] Iteration ${iterations}/${maxIterations} - Checked: ${memory.checkedKeywords.size}, Good: ${memory.goodKeywords.length}`);
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: [checkKeywordTool],
      tool_choice: "auto",
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("No response from OpenAI");
    }

    messages.push(assistantMessage);

    // Wenn keine Tool-Calls, ist der Agent fertig
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[Agent] Completed after ${iterations} iterations`);
      console.log(`[Agent] Final: ${memory.checkedKeywords.size} checked, ${memory.goodKeywords.length} good`);
      
      // Parse das finale Ergebnis
      const content = assistantMessage.content || "[]";
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (parsed.keywords && Array.isArray(parsed.keywords)) {
          return parsed.keywords;
        }
      } catch {
        // Versuche Array aus dem Text zu extrahieren
        const arrayMatch = content.match(/\[[\s\S]*?\]/);
        if (arrayMatch) {
          try {
            return JSON.parse(arrayMatch[0]);
          } catch {
            console.warn("[Agent] Could not parse array from response");
          }
        }
      }
      
      // Fallback: Gib die guten Keywords aus dem Memory zurück
      if (memory.goodKeywords.length > 0) {
        console.log(`[Agent] Using ${memory.goodKeywords.length} good keywords from memory`);
        return memory.goodKeywords.slice(0, 20);
      }
      
      return [];
    }

    // Führe die Tools aus
    console.log(`[Agent] Executing ${assistantMessage.tool_calls.length} tool calls...`);
    const toolResults = await processToolCalls(assistantMessage.tool_calls, memory);
    messages.push(...toolResults);
  }

  console.warn(`[Agent] Max iterations (${maxIterations}) reached`);
  return memory.goodKeywords.slice(0, 20);
}

/**
 * Location-Finder Agent
 * Sucht auf der Website nach Branche und Standort
 */
export async function findLocationAndGenre(
  input: WorkflowInput
): Promise<LocationFinderOutput> {
  const systemPrompt = `Suche auf der Website nach Branche und Standort. Gebe bei Location wirklich nur die Stadt an. Gebe bei fullLocation die Stadt mit Bundesland (auf Englisch) an.

Antworte IMMER im folgenden JSON Format:
{
  "location": "STADT",
  "fullLocation": "STADT, BUNDESLAND",
  "genre": "BRANCHE"
}`;

  const userPrompt = `URL: ${input.website}
Firmenbeschreibung: ${input.company_purpose.description}`;

  let websiteContent = "";
  
  try {
    const crawlResult = await crawlWebsite({
      url: input.website,
      what: "Standort, Adresse, Branche, Geschäftsbereich"
    });
    websiteContent = crawlResult.content;
  } catch (error) {
    console.warn("Could not crawl website:", error);
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { 
      role: "user", 
      content: websiteContent 
        ? `${userPrompt}\n\nWebsite Inhalt:\n${websiteContent.substring(0, 4000)}`
        : userPrompt
    },
  ];

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  return JSON.parse(content) as LocationFinderOutput;
}

/**
 * Location Fallback via Google Search + Firecrawl
 * Wird aufgerufen wenn findLocationAndGenre() keine Location/Genre findet
 * 
 * Strategie:
 * 1. Google-Suche nach "{Firmenname} Standort Adresse" via Firecrawl
 * 2. Top-Ergebnis (ohne eigene Domain und Portale) crawlen
 * 3. OpenAI extrahiert Location + Genre aus dem gecrawlten Inhalt
 */
export async function findLocationViaGoogleSearch(
  companyName: string,
  website: string
): Promise<LocationFinderOutput | null> {
  // Dynamischer Import um zirkuläre Dependencies zu vermeiden
  const { searchGoogle, scrapeWithFirecrawl } = await import("./firecrawl");
  const { DOMAIN_BLACKLIST } = await import("../constants/domainBlacklist");
  
  console.log(`[LocationFallback] Starting Google search fallback for "${companyName}"`);
  
  // Extrahiere eigene Domain zum Ausfiltern
  let ownDomain = "";
  try {
    ownDomain = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    console.warn(`[LocationFallback] Could not parse website URL: ${website}`);
  }
  
  // Domains die für Location-Suche relevant sind (z.B. Google Maps, Branchenverzeichnisse)
  const relevantForLocation = [
    "google.com",
    "google.de",
    "maps.google",
  ];
  
  // Versuche verschiedene Suchanfragen
  const searchQueries = [
    `${companyName} Standort Adresse`,
    `${companyName} Impressum`,
    `${companyName} Kontakt`,
  ];
  
  for (const query of searchQueries) {
    console.log(`[LocationFallback] Searching: "${query}"`);
    
    const urls = await searchGoogle(query, 10);
    
    if (urls.length === 0) {
      console.log(`[LocationFallback] No results for query`);
      continue;
    }
    
    // Filtere URLs: Keine eigene Domain, keine Blacklist-Portale (ausser Google Maps)
    const filteredUrls = urls.filter((url) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        
        // Eigene Domain ausschliessen
        if (hostname === ownDomain || hostname.includes(ownDomain)) {
          return false;
        }
        
        // Google Maps ist erlaubt
        if (relevantForLocation.some(d => hostname.includes(d))) {
          return true;
        }
        
        // Blacklist-Portale ausschliessen
        if (DOMAIN_BLACKLIST.some(bl => hostname.includes(bl))) {
          return false;
        }
        
        return true;
      } catch {
        return false;
      }
    });
    
    if (filteredUrls.length === 0) {
      console.log(`[LocationFallback] All URLs filtered out`);
      continue;
    }
    
    // Crawle das erste relevante Ergebnis
    const targetUrl = filteredUrls[0];
    if (!targetUrl) continue;
    
    console.log(`[LocationFallback] Crawling: ${targetUrl}`);
    const content = await scrapeWithFirecrawl(targetUrl);
    
    if (!content || content.trim().length < 50) {
      console.log(`[LocationFallback] No useful content from ${targetUrl}`);
      continue;
    }
    
    // Extrahiere Location + Genre mit OpenAI
    const result = await extractLocationFromContent(content, companyName);
    
    if (result && (result.location?.trim() || result.genre?.trim())) {
      console.log(`[LocationFallback] Found via "${query}":`, JSON.stringify(result));
      return result;
    }
  }
  
  console.log(`[LocationFallback] No location found via any search query`);
  return null;
}

/**
 * Extrahiert Location und Genre aus beliebigem Text-Content
 * Wird von findLocationViaGoogleSearch() verwendet
 */
async function extractLocationFromContent(
  content: string,
  companyName: string
): Promise<LocationFinderOutput | null> {
  const systemPrompt = `Du bist ein Experte für die Extraktion von Firmendaten.
Extrahiere aus dem gegebenen Text den STANDORT und die BRANCHE der Firma "${companyName}".

Wichtig:
- Bei Location nur die STADT angeben (z.B. "München", "Berlin")
- Bei fullLocation Stadt mit Bundesland auf Englisch (z.B. "Munich, Bavaria")
- Bei genre die Branche/Geschäftsbereich (z.B. "Heizung & Sanitär", "IT Beratung")
- Wenn eine Information nicht gefunden wird, leeren String zurückgeben

Antworte IMMER im folgenden JSON Format:
{
  "location": "STADT",
  "fullLocation": "STADT, BUNDESLAND",
  "genre": "BRANCHE"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: SMALL_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Firma: ${companyName}\n\nText:\n${content.substring(0, 6000)}`
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const responseContent = response.choices[0]?.message?.content;
    if (!responseContent) {
      return null;
    }

    const parsed = JSON.parse(responseContent) as LocationFinderOutput;
    return parsed;
  } catch (error) {
    console.error(`[LocationFallback] OpenAI extraction error:`, error);
    return null;
  }
}

/**
 * Keyword Extractor Agent (by description)
 * Extrahiert Keywords aus der Firmenbeschreibung
 * MIT Tool für SERP-Validierung (wie im n8n Workflow)
 */
export async function extractKeywordsFromDescription(
  description: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein erfahrener SEO-Spezialist für lokale Unternehmen in Deutschland.

DEINE AUFGABE:
Extrahiere die wichtigsten SEO-Keywords aus der Firmenbeschreibung.

WICHTIGE REGELN FÜR GUTE KEYWORDS:
1. Kurze, prägnante Keywords (1-3 Wörter) - KEINE langen Phrasen
2. Denke wie ein Kunde der nach dieser Dienstleistung sucht
3. Verwende Branchen-typische Suchbegriffe wie:
   - Berufsbezeichnungen: "Heizungsinstallateur", "Sanitärfachmann", "Klempner"
   - Dienstleistungen: "Heizung", "Sanitär", "Badezimmer", "Badsanierung"
   - Kombinationen: "Heizungsfirma", "Sanitärbetrieb", "Heizungsmonteur"
4. KEINE Firmennamen oder Markennamen
5. KEINE zu spezifischen Fachbegriffe die Kunden nicht suchen würden
6. KEINE langen beschreibenden Phrasen wie "effiziente Heiztechnik zur Energieeinsparung"

BEISPIELE FÜR GUTE KEYWORDS (Sanitär/Heizung Branche):
- "Heizung"
- "Sanitär" 
- "Heizungsinstallateur"
- "Badezimmer"
- "Badsanierung"
- "Heizungsfirma"
- "Klempner"
- "Heizungsmonteur"
- "Gasheizung"
- "Wärmepumpe"

Nutz das mitgegebene Tool um zu validieren, wie gut das Keyword ist.

Bitte gib deine Antwort als Array aus: ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]`;

  console.log(`[OpenAI] Extracting keywords from description (${description.length} chars)...`);
  
  return runKeywordAgent(systemPrompt, description, locationCode);
}

/**
 * Keyword Extractor Agent (by company purpose/services)
 * Extrahiert Keywords aus den Services/USPs
 * MIT Tool für SERP-Validierung (wie im n8n Workflow)
 */
export async function extractKeywordsFromServices(
  services: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein erfahrener SEO-Spezialist für lokale Unternehmen in Deutschland.

DEINE AUFGABE:
Extrahiere die wichtigsten SEO-Keywords aus den Services/Dienstleistungen der Firma.

WICHTIGE REGELN FÜR GUTE KEYWORDS:
1. Kurze, prägnante Keywords (1-3 Wörter) - KEINE langen Phrasen
2. Denke wie ein Kunde der nach dieser Dienstleistung sucht
3. Verwende Branchen-typische Suchbegriffe:
   - Berufsbezeichnungen: "Heizungsinstallateur", "Sanitärfachmann", "Installateur"
   - Dienstleistungen: "Heizung", "Sanitär", "Bad", "Lüftung"
   - Produkte: "Wärmepumpe", "Gasheizung", "Fußbodenheizung"
4. KEINE Firmennamen oder zu spezifische Fachbegriffe
5. KEINE langen beschreibenden Phrasen

BEISPIELE FÜR GUTE KEYWORDS:
- "Heizungstechnik"
- "Badezimmer"
- "Trinkwasser"
- "Lüftungsanlage"
- "Heizungswartung"
- "Sanitärinstallation"
- "Badplanung"

Nutz das mitgegebene Tool um zu validieren, wie gut das Keyword ist.

Bitte gib deine Antwort als Array aus: ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]`;

  console.log(`[OpenAI] Extracting keywords from services (${services.length} chars)...`);
  
  return runKeywordAgent(systemPrompt, services, locationCode);
}

/**
 * Keyword Searcher Agent
 * Generiert lokale SEO-Synonyme zu Keywords
 * MIT Tool für SERP-Validierung (wie im n8n Workflow)
 */
export async function generateLocalSEOKeywords(
  keywords: string[],
  genre: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Aufgabe:
Erzeuge zu jedem der folgenden Keywords eine Liste relevanter lokaler SEO-Synonyme.

Kontext & Ziel:
Branche der Firma: ${genre}
Fokus auf lokale Suchanfragen in Deutschland
Nutzerintention: Dienstleistung / Anbieter vor Ort finden

WICHTIG - Keyword-Struktur:
Die Keywords haben bereits einen Ortsnamen am Ende (z.B. "Heizung Minden").
Generiere Variationen mit demselben Ort, z.B.:
- "Heizung Minden" → "Heizungsinstallateur Minden", "Heizungsfirma Minden", "Heizungsmonteur Minden"
- "Sanitär Minden" → "Sanitärinstallateur Minden", "Klempner Minden", "Sanitärbetrieb Minden"

Regeln:
- Verwende ausschließlich deutsche Begriffe
- Kurze Keywords (2-3 Wörter inkl. Ort)
- Synonyme müssen inhaltlich gleichwertig sein
- Typische lokale Suchmuster verwenden
- Berufs- und Dienstleisterbezeichnungen einbeziehen
- KEINE langen Phrasen
- KEINE Wiederholungen
- KEINE Erklärungen

Nutz das mitgegebene Tool um zu validieren, wie gut das Keyword ist.

Gebe deine Antwort als Array aus:
["Keyword1","Keyword2","Keyword3",...]`;

  console.log(`[OpenAI] Generating local SEO keywords for ${keywords.length} base keywords...`);
  
  return runKeywordAgent(systemPrompt, JSON.stringify(keywords), locationCode);
}

/**
 * Keyword Validator Agent
 * Überprüft ob Keywords zur Branche passen
 */
export async function validateKeywords(
  keywords: string[],
  genre: string
): Promise<string[]> {
  const systemPrompt = `Aufgabe:
Überprüfe ob die Keywords zu der Branche der Firma passen und entferne unpassende Keywords.

Branche der Firma: ${genre}

Regeln:
- BEHALTE kurze, prägnante Keywords (1-3 Wörter + Ort)
- ENTFERNE zu lange oder zu spezifische Keywords
- ENTFERNE Keywords die nicht zur Branche passen
- ENTFERNE doppelte oder sehr ähnliche Keywords
- BEHALTE Berufsbezeichnungen und Dienstleistungsnamen
- Verwende ausschließlich deutsche Begriffe

Gebe deine Antwort als JSON aus:
{"keywords": ["Keyword1","Keyword2","Keyword3",...]}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(keywords) },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  const parsed = JSON.parse(content);
  return parsed.keywords || [];
}

/**
 * Cache für bereits validierte Domains um Apify-Calls zu sparen
 * LRU Cache mit max 1000 Einträgen
 */
const companyValidationCache = new Map<string, boolean>();
const MAX_CACHE_SIZE = 1000;

/**
 * Cache für Entity-Klassifikation (inkl. Branche und Typ)
 * LRU Cache mit max 1000 Einträgen
 */
const entityClassificationCache = new Map<string, EntityClassification>();

/**
 * Fügt Eintrag zu Map hinzu mit LRU-Eviction
 * Entfernt ältesten Eintrag wenn Max-Größe erreicht
 */
function addToLRUCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Entferne ältesten Eintrag (erster in der Map)
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

/**
 * Prüft ob eine URL eine einzelne Firma oder ein Branchenportal ist
 * Nutzt KI um den Content zu analysieren
 * Ergebnis wird gecacht um Duplizierung zu vermeiden
 */
export async function isSingleCompanyWebsite(url: string): Promise<boolean> {
  // Check cache first
  const cached = companyValidationCache.get(url);
  if (cached !== undefined) {
    console.log(`[CompanyValidator] Cache hit for "${url}": ${cached}`);
    return cached;
  }

  console.log(`[CompanyValidator] Checking if "${url}" is a single company website...`);

  try {
    // Use lightweight crawler (Puppeteer only, no Apify) to avoid memory limit errors
    const crawlResult = await crawlWebsiteLightweight({
      url,
      what: "Ist dies die Website eines einzelnen Unternehmens mit eigenem Angebot, oder ein Branchenportal/Verzeichnis mit vielen verschiedenen Firmen? Analysiere: 1) Gibt es ein Impressum mit einer einzelnen Firmenadresse? 2) Werden Dienstleistungen von nur einer Firma beschrieben? 3) Gibt es 'für Partner' oder 'für Unternehmen' Sektionen? 4) Gibt es eine klare 'Über uns' Seite mit Unternehmensgeschichte? Antworte mit JSON: {isSingleCompany: boolean, reason: string}"
    });

    if (!crawlResult.content || crawlResult.content.trim().length === 0) {
      console.warn("[CompanyValidator] No content scraped, using fallback logic");
      return isCompanyByHeuristics(url);
    }

    const response = await openai.chat.completions.create({
      model: SMALL_MODEL,
      messages: [
        {
          role: "system",
          content: `Du bist ein SEO-Experte. Analysiere die Website-Beschreibung und entscheide ob es sich um:
1. EIN EINZELNES UNTERNEHMEN mit eigener Website (gut) - z.B. "Sültemeyer Sanitär-Heizung GmbH" mit eigener Firmenadresse, eigenem Team, eigenen Projekten
2. EIN BRANCHENPORTAL/VERZEICHNIS (schlecht) - z.B. "Heizungsfinder.de" mit hunderten verschiedenen Firmen, "finden Sie Installateur in Ihrer Stadt", "für Partner werden" Button

Antworte NUR mit gültigem JSON ohne weitere Erklärungen:
{"isSingleCompany": true/false, "reason": "kurze Begründung"}`
        },
        {
          role: "user",
          content: `Analysiere diese Website:\n\n${crawlResult.content.substring(0, 5000)}`
        }
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn("[CompanyValidator] No AI response, using fallback");
      return isCompanyByHeuristics(url);
    }

     const parsed = JSON.parse(content);
     const isSingle = parsed.isSingleCompany === true;
     
     // Cache result mit LRU
     addToLRUCache(companyValidationCache, url, isSingle);
     console.log(`[CompanyValidator] Result for ${url}: isSingleCompany=${isSingle}, reason=${parsed.reason}`);
     return isSingle;

    } catch (error) {
      console.error(`[CompanyValidator] Error checking ${url}:`, error);
      const result = isCompanyByHeuristics(url);
      // Cache fallback result too
      addToLRUCache(companyValidationCache, url, result);
      return result;
    }
 }

/**
 * Fallback-Heuristik wenn KI nicht verfügbar
 * Prüft typische Muster in der URL und Domain
 */
function isCompanyByHeuristics(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsedUrl.pathname.toLowerCase();

    const companyIndicators = [
      /^[a-z-]+\.(de|com|net|org)$/, // z.B. "sueltemeyer.de"
      /\.(heizung|sanitaer|klempner|installation|bauer|handwerk)/, // Branchen-Domain
    ];

    const portalIndicators = [
      /finder$/,
      /vergleich$/,
      /test$/,
      /check$/,
      /guide$/,
      /-[a-z]+-in-/,
      /\/(finden|vergleich|test)\//,
    ];

    for (const pattern of portalIndicators) {
      if (pattern.test(hostname) || pattern.test(pathname)) {
        console.log(`[CompanyValidator] [Heuristic] ${url} detected as portal`);
        return false;
      }
    }

    for (const pattern of companyIndicators) {
      if (pattern.test(hostname)) {
        console.log(`[CompanyValidator] [Heuristic] ${url} detected as company`);
        return true;
      }
    }

    // Im Zweifel als Portal behandeln - sicherer, da Crawler-Fehler nicht zu falschen Positiven führen
    console.log(`[CompanyValidator] [Heuristic] ${url} ambiguous, defaulting to false (safer)`);
    return false;

  } catch {
    return true;
  }
}

/**
 * Validiert mehrere Domains parallel
 * Gibt zurück welche Domains echte Unternehmen sind
 */
export async function validateCompanyDomains(
  domains: Array<{ domain: string; rank: number }>
): Promise<Array<{ domain: string; rank: number }>> {
  console.log(`[CompanyValidator] Validating ${domains.length} domains in parallel...`);

  if (domains.length === 0) {
    return [];
  }

  const results = await Promise.all(
    domains.map(async (item) => {
      try {
        const crawlResult = await crawlWebsiteLightweight({
          url: item.domain,
          what: "Ist dies eine einzelne Firma oder ein Portal?"
        });

        const hasContent = crawlResult.content && crawlResult.content.trim().length > 0;
        const isCompany = hasContent ? await isSingleCompanyWebsite(item.domain) : false;

        if (isCompany) {
          console.log(`[CompanyValidator] Valid company: ${item.domain}`);
          return item;
        } else {
          console.log(`[CompanyValidator] Filtered out portal: ${item.domain}`);
          return null;
        }
      } catch (error) {
        console.error(`[CompanyValidator] Error validating ${item.domain}:`, error);
        return null;
      }
    })
  );

  const validCompanies = results.filter((item): item is { domain: string; rank: number } => item !== null);

  console.log(`[CompanyValidator] Validated: ${validCompanies.length}/${domains.length} are companies`);
  return validCompanies;
}

// ============================================================================
// ERWEITERTE ENTITY-KLASSIFIKATION (NEU)
// ============================================================================

/**
 * Klassifiziert einen Wettbewerber nach Entity-Typ und Branchenrelevanz
 *
 * Erweiterte Version von isSingleCompanyWebsite() mit:
 * - Branchenerkennung des Wettbewerbers
 * - Vergleich mit Kundenbranche
 * - Dienstleister vs. Händler Unterscheidung
 * - Confidence Score
 *
 * @param url Die URL des Wettbewerbers
 * @param customerGenre Die Branche des Kunden (z.B. "Heizung & Sanitär")
 * @param customerEntityType Der Geschäftstyp des Kunden
 */
export async function classifyCompetitorEntity(
  url: string,
  customerGenre: string,
  customerEntityType: EntityType
): Promise<EntityClassification> {
  // Cache-Key inkludiert Kundenkontext
  const cacheKey = `${url}|${customerGenre}|${customerEntityType}`;

  const cached = entityClassificationCache.get(cacheKey);
  if (cached) {
    console.log(`[EntityClassifier] Cache hit for "${url}"`);
    return cached;
  }

  console.log(`[EntityClassifier] Classifying: ${url} (customer: ${customerGenre}, ${customerEntityType})`);

  try {
    // Lightweight Crawl der Wettbewerber-Website
    const crawlResult = await crawlWebsiteLightweight({
      url,
      what: "Analysiere: 1) Ist dies ein einzelnes Unternehmen oder Portal? 2) Bietet es Dienstleistungen oder verkauft es Produkte? 3) Welche Branche? 4) Impressum/Kontakt vorhanden?",
    });

    if (!crawlResult.content || crawlResult.content.trim().length === 0) {
      console.warn(`[EntityClassifier] No content for ${url}, using fallback`);
      return createFallbackClassification(url, customerGenre, customerEntityType);
    }

    // KI-Klassifikation mit erweitertem Prompt
    const systemPrompt = `Du bist ein SEO- und Wettbewerbsanalyst. Analysiere die Website und klassifiziere sie.

KUNDENKONTEXT:
- Branche des Kunden: ${customerGenre}
- Geschäftstyp des Kunden: ${customerEntityType === "dienstleister" ? "Dienstleister (bietet Services)" : customerEntityType === "haendler" ? "Händler (verkauft Produkte)" : "Hybrid (beides)"}

ANALYSIERE FOLGENDES:

1. UNTERNEHMENSART:
   - EINZELUNTERNEHMEN: Eine Firma mit eigenem Impressum, Team, Projekten
   - PORTAL/VERZEICHNIS: Viele verschiedene Firmen gelistet, "Partner werden", Städtelisten

2. GESCHÄFTSTYP:
   - DIENSTLEISTER: Bietet Services an (Installation, Beratung, Reparatur, etc.)
   - HÄNDLER: Verkauft Produkte (Online-Shop, Warenkorb, Preislisten)
   - HYBRID: Beides (z.B. Fachhandel mit Montageservice)

3. BRANCHENRELEVANZ zum Kunden:
   - Kunde ist "${customerGenre}"
   - Ist dieser Wettbewerber in derselben oder verwandten Branche?
   - IRRELEVANT wenn:
     * "Maler" vs "Autolackierer" (andere Branche trotz ähnlicher Worte)
     * "Heizungsbauer" vs "Baumarkt" (Händler, kein Dienstleister)
     * "IT-Dienstleister" vs "Software-Hersteller" (anderes Geschäftsmodell)

4. CONFIDENCE:
   - 0.9+ wenn Impressum, klare Leistungen, eindeutige Signale
   - 0.7-0.9 wenn wahrscheinlich, aber nicht 100% sicher
   - 0.5-0.7 wenn unklar oder gemischte Signale
   - <0.5 wenn Website nicht aussagekräftig

Antworte NUR mit gültigem JSON:
{
  "isCompany": true/false,
  "entityType": "dienstleister" | "haendler" | "hybrid" | "unknown",
  "detectedGenre": "Erkannte Branche des Wettbewerbers",
  "isRelevantCompetitor": true/false,
  "confidence": 0.0-1.0,
  "reason": "Kurze Begründung (max 50 Wörter)"
}`;

    const response = await openai.chat.completions.create({
      model: SMALL_MODEL, // gpt-4.1-nano für Kosten-Effizienz
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analysiere diese Website:\n\nURL: ${url}\n\nContent:\n${crawlResult.content.substring(0, 5000)}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // Niedrige Temperatur für konsistente Ergebnisse
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn(`[EntityClassifier] No AI response for ${url}`);
      return createFallbackClassification(url, customerGenre, customerEntityType);
    }

    const parsed = JSON.parse(content) as EntityClassification;

    // Validiere und normalisiere
    const result: EntityClassification = {
      isCompany: parsed.isCompany === true,
      entityType: validateEntityType(parsed.entityType),
      detectedGenre: parsed.detectedGenre || "unbekannt",
      isRelevantCompetitor: parsed.isRelevantCompetitor === true,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reason: parsed.reason || "Keine Begründung",
    };

    // Cache speichern mit LRU
    addToLRUCache(entityClassificationCache, cacheKey, result);

    console.log(
      `[EntityClassifier] ${url}: isCompany=${result.isCompany}, type=${result.entityType}, genre="${result.detectedGenre}", relevant=${result.isRelevantCompetitor}, confidence=${result.confidence.toFixed(2)}`
    );

    return result;
  } catch (error) {
    console.error(`[EntityClassifier] Error classifying ${url}:`, error);
    return createFallbackClassification(url, customerGenre, customerEntityType);
  }
}

/**
 * Validiert und normalisiert den EntityType
 */
function validateEntityType(type: string | undefined): EntityType {
  const validTypes: EntityType[] = ["dienstleister", "haendler", "hybrid", "unknown"];
  if (type && validTypes.includes(type as EntityType)) {
    return type as EntityType;
  }
  return "unknown";
}

/**
 * Erstellt eine Fallback-Klassifikation basierend auf Heuristiken
 */
function createFallbackClassification(
  url: string,
  customerGenre: string,
  customerEntityType: EntityType
): EntityClassification {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");

    // Portal-Indikatoren (schlecht)
    const portalPatterns = [
      /finder$/,
      /vergleich$/,
      /check24/,
      /myhammer/,
      /wer-liefert-was/,
      /gelbeseiten/,
      /yelp/,
      /-portal/,
      /verzeichnis/,
    ];

    // Händler-Indikatoren
    const haendlerPatterns = [
      /shop/,
      /store/,
      /markt/,
      /handel/,
      /amazon/,
      /ebay/,
      /otto/,
      /hornbach/,
      /obi\./,
      /bauhaus/,
    ];

    // Portal-Check
    for (const pattern of portalPatterns) {
      if (pattern.test(hostname)) {
        return {
          isCompany: false,
          entityType: "unknown",
          detectedGenre: "Portal/Verzeichnis",
          isRelevantCompetitor: false,
          confidence: 0.7,
          reason: `Domain-Muster "${pattern}" deutet auf Portal hin`,
        };
      }
    }

    // Händler-Check (wenn Kunde Dienstleister ist)
    if (customerEntityType === "dienstleister") {
      for (const pattern of haendlerPatterns) {
        if (pattern.test(hostname)) {
          return {
            isCompany: true,
            entityType: "haendler",
            detectedGenre: "Einzelhandel",
            isRelevantCompetitor: false,
            confidence: 0.6,
            reason: `Domain-Muster "${pattern}" deutet auf Händler hin, Kunde ist Dienstleister`,
          };
        }
      }
    }

    // Default: Als potenziell relevant markieren, aber mit niedriger Confidence
    return {
      isCompany: true,
      entityType: "unknown",
      detectedGenre: "unbekannt",
      isRelevantCompetitor: true,
      confidence: 0.4,
      reason: "Fallback-Heuristik, keine eindeutigen Signale",
    };
  } catch {
    return {
      isCompany: false,
      entityType: "unknown",
      detectedGenre: "unbekannt",
      isRelevantCompetitor: false,
      confidence: 0.2,
      reason: "URL-Parsing fehlgeschlagen",
    };
  }
}

/**
 * Erkennt den Entity-Typ des Kunden aus seiner Website
 * Wird in findLocationAndGenre() integriert
 */
export async function detectCustomerEntityType(
  websiteContent: string,
  description: string
): Promise<EntityType> {
  const systemPrompt = `Analysiere ob dieses Unternehmen ein DIENSTLEISTER (bietet Services/Arbeit an) oder ein HÄNDLER (verkauft Produkte) ist.

Beispiele:
- DIENSTLEISTER: Handwerker, Berater, Agenturen, IT-Support, Installationsfirmen, Maler, Elektriker
- HÄNDLER: Shops, Fachhandel, Großhandel, Online-Versand, Baumärkte
- HYBRID: Fachhandel mit Montageservice, Autohäuser mit Werkstatt

Antworte NUR mit einem Wort: "dienstleister", "haendler" oder "hybrid"`;

  try {
    const response = await openai.chat.completions.create({
      model: SMALL_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Website-Inhalt:\n${websiteContent.substring(0, 3000)}\n\nFirmenbeschreibung:\n${description}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content?.toLowerCase().trim();

    if (content === "dienstleister") return "dienstleister";
    if (content === "haendler") return "haendler";
    if (content === "hybrid") return "hybrid";

    console.warn(`[EntityDetection] Unexpected response: "${content}", defaulting to dienstleister`);
    return "dienstleister";
  } catch (error) {
    console.error("[EntityDetection] Error:", error);
    return "dienstleister"; // Sicherer Default
  }
}

// ============================================================================
// INTENT-BASED KEYWORD GENERATION (Ticket: Keyword-Generierung Neudesign)
// ============================================================================

import { findIndustryTemplate, getTemplatePromptSection } from "./keywordTemplates";

/**
 * Ergebnis der Intent-Keyword-Generierung
 */
export interface IntentKeywordResult {
  keywords: string[];
  clusters: Array<{
    name: string;
    keywords: string[];
  }>;
}

/**
 * Input für Intent-Keyword-Generierung
 */
export interface IntentKeywordInput {
  company_name: string;
  industry: string;
  industry_subcategory?: string;
  custom_subcategory?: string;
  description: string;
  company_purpose: string;
  location: string;
  operating_region: "regional" | "nationwide" | string;
}

/**
 * Hard-Filter für offensichtlich falsche Intents
 * Wird VOR und NACH der KI-Generierung angewendet
 * 
 * Format: Reguläre Ausdrücke für Wortgrenzen-basiertes Matching
 */
export async function generateIntentKeywords(
  input: IntentKeywordInput
): Promise<IntentKeywordResult> {
  console.log(`[IntentKeywords] Generating intent keywords for ${input.company_name}...`);
  console.log(`[IntentKeywords] Industry: ${input.industry}, Subcategory: ${input.industry_subcategory || "none"}`);
  console.log(`[IntentKeywords] Operating region: ${input.operating_region}, Location: ${input.location}`);

  // Finde passendes Branchen-Template
  const template = findIndustryTemplate(
    input.industry,
    input.industry_subcategory || input.custom_subcategory
  );
  
  if (template) {
    console.log(`[IntentKeywords] Found industry template with ${template.patterns.length} patterns`);
  } else {
    console.log(`[IntentKeywords] No specific template found, using generic prompt`);
  }

  const templateSection = getTemplatePromptSection(template);
  const isRegional = input.operating_region === "regional";

  // Standortlogik gemäß Prompt
  const locationInstruction = isRegional
    ? `STANDORTLOGIK (VERBINDLICH):
Da operating_region = "regional" gilt:
- KEINE Orte in den Keywords verwenden
- Keywords rein thematisch generieren
- Der Standort '${input.location}' wird separat übergeben, nicht in den Keywords eingebaut
- Beispiel korrekt: "Malerbetrieb", "Wohnung streichen lassen", "Heizungswartung"
- Beispiel falsch: "Malerbetrieb ${input.location}" (keine Keywords mit Stadt anhängen)`
    : `STANDORTLOGIK (VERBINDLICH):
Da operating_region = "nationwide" gilt:
- KEINE Orte in den Keywords verwenden
- Keywords rein thematisch generieren
- Fokus auf Bedürfnis + Anbieterintention`;

  const systemPrompt = `## Rolle & Haltung

Du bist ein Spezialist für:
- reales Suchverhalten
- Google-SERPs
- Nutzerpsychologie
- Kaufintention
- Dienstleister-Suchen

Du arbeitest NICHT wie ein SEO-Tool, sondern wie ein Mensch, der täglich echte Suchanfragen analysiert.

Dein Maßstab ist immer die Frage:
> "Würde ein echter Mensch das wirklich genau so in Google eintippen, wenn er einen Anbieter sucht?"

Du denkst strikt:
- aus Kundensicht
- mit Alltagssprache
- ohne Marketingsprech
- ohne Fachjargon
- ohne interne Begriffe
- ohne Unternehmensperspektive

---

## Ziel der Keywords

Erzeuge Suchanfragen, die:

- reale Nachfrage abbilden
- Anbieter-Intention haben (Kontakt / Beauftragung / Angebot)
- zu Dienstleistern führen (nicht zu Portalen, Shops, Lexika)
- linguistisch natürlich wirken
- branchenspezifisch korrekt sind
- wirtschaftlich verwertbar sind (Leads, nicht Traffic-Spielerei)

Jedes Keyword muss implizit bedeuten:
> "Ich suche einen Anbieter, den ich beauftragen kann."

---

## Absolute Ausschlusskriterien (Hard Filter)

Keines der Keywords darf enthalten oder implizieren:

- Fachbegriffe, die nur Insider kennen
- Marketingsprache ("maßgeschneidert", "innovativ", "führend")
- interne Leistungsbezeichnungen
- Produktnamen (außer bei Produzenten explizit gefordert)
- Portale (z.B. Check24, MyHammer, Wer liefert was etc.)
- Shops / E-Commerce
- Wissen / Recherche / Definition
- Ausbildung, Jobs, Karriere
- Vergleiche ("bester Anbieter", "Test", "Ranking")
- falsche Branchen-Assoziationen

Wenn ein Keyword diese Kriterien verletzt → es darf NICHT generiert werden.

---

## Bevorzugte Sprachmuster

Bevorzuge Suchlogiken wie echte Nutzer:

- "firma für …"
- "anbieter für …"
- "betrieb für …"
- "dienstleister für …"
- "beratung zu …"
- "… machen lassen"
- "… beauftragen"
- "angebot für …"
- "… in der nähe"
- "… kosten"
- "… kontakt"

Sprache:
- einfach
- konkret
- intuitiv
- alltagstauglich
- nicht technisch

---

${locationInstruction}

---
${templateSection}
---

## Interne Qualitätsprüfung (Pflicht vor Ausgabe)

Bevor du die Liste ausgibst, prüfe jedes Keyword intern gegen folgende Fragen:

- Klingt das wie echte Sprache?
- Würde jemand das genau so tippen?
- Führt das zu Dienstleistern?
- Passt es zur Branche?
- Hat es Kontakt- oder Beauftragungsintention?

Nur Keywords, die alle Fragen bestehen, dürfen ausgegeben werden.

---

## Ausgabeformat (verbindlich)

Antworte NUR mit gültigem JSON im folgenden Format:
{
  "keywords": ["keyword1", "keyword2", ... bis zu 60 Keywords],
  "clusters": [
    {"name": "Clustername", "keywords": ["keyword1", "keyword2"]},
    ...
  ]
}

Cluster-Beispiele:
- Anbieter / Firma suchen
- Angebot & Preise
- Beratung & Unterstützung
- Spezifische Leistungen
- Branchenfokus

KEINE Erklärungen. KEINE Meta-Kommentare. NUR JSON.`;

  const userPrompt = `Generiere Intent-Keywords für folgendes Unternehmen:

Unternehmen: ${input.company_name}
Branche: ${input.industry}${input.industry_subcategory ? ` / ${input.industry_subcategory}` : ""}
Leistungen/Beschreibung: ${input.description}
Zweck/Nutzen: ${input.company_purpose}
Standort: ${input.location}
Operating Region: ${input.operating_region}

Generiere mindestens 50 Keywords mit thematischer Clusterung.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsed = JSON.parse(content) as IntentKeywordResult;
    
    // Validiere Struktur
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) {
      console.warn("[IntentKeywords] Invalid response structure, extracting keywords...");
      // Versuche Keywords aus dem Objekt zu extrahieren
      const extractedKeywords: string[] = [];
      if (parsed.clusters && Array.isArray(parsed.clusters)) {
        for (const cluster of parsed.clusters) {
          if (cluster.keywords && Array.isArray(cluster.keywords)) {
            extractedKeywords.push(...cluster.keywords);
          }
        }
      }
      parsed.keywords = extractedKeywords;
    }

    // Wende Hard-Filter an
    const originalCount = parsed.keywords.length;
    parsed.keywords = applyHardFilters(parsed.keywords);
    
    if (parsed.keywords.length < originalCount) {
      console.log(`[IntentKeywords] Hard-filtered ${originalCount - parsed.keywords.length} keywords`);
    }

    // Aktualisiere auch Cluster-Keywords
    if (parsed.clusters && Array.isArray(parsed.clusters)) {
      for (const cluster of parsed.clusters) {
        if (cluster.keywords && Array.isArray(cluster.keywords)) {
          cluster.keywords = applyHardFilters(cluster.keywords);
        }
      }
    }

    console.log(`[IntentKeywords] Generated ${parsed.keywords.length} intent keywords`);
    console.log(`[IntentKeywords] Sample: ${parsed.keywords.slice(0, 5).join(", ")}`);

    return parsed;
  } catch (error) {
    console.error("[IntentKeywords] Error generating keywords:", error);
    throw error;
  }
}

/**
 * Wählt die besten Keywords für SERP/Wettbewerber-Analyse aus
 * Priorisiert transaktionale Keywords mit Anbieter-Intent
 */
export function selectTopKeywordsForSERP(
  result: IntentKeywordResult,
  maxKeywords: number = 50
): string[] {
  const keywords = result.keywords;
  
  if (keywords.length <= maxKeywords) {
    return keywords;
  }

  // Priorisiere Keywords mit starken transaktionalen Signalen
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
  ];

  const scored = keywords.map(kw => {
    let score = 0;
    for (const pattern of transactionalPatterns) {
      if (pattern.test(kw)) {
        score += 1;
      }
    }
    return { keyword: kw, score };
  });

  // Sortiere nach Score (höchster zuerst), dann nach Position (für Stabilität)
  scored.sort((a, b) => b.score - a.score);

  // Wähle diverse Keywords aus verschiedenen Clustern wenn möglich
  const selected: string[] = [];
  const usedClusters = new Set<string>();

  // Erst: Je 1-2 Keywords pro Cluster
  if (result.clusters && result.clusters.length > 0) {
    for (const cluster of result.clusters) {
      if (selected.length >= maxKeywords) break;
      
      const clusterKeywords = cluster.keywords.filter(kw => 
        !selected.includes(kw) && keywords.includes(kw)
      );
      
      // Nimm bis zu 2 Keywords pro Cluster
      for (const kw of clusterKeywords.slice(0, 2)) {
        if (selected.length < maxKeywords && !selected.includes(kw)) {
          selected.push(kw);
          usedClusters.add(cluster.name);
        }
      }
    }
  }

  // Dann: Fülle mit höchst-bewerteten Keywords auf
  for (const { keyword } of scored) {
    if (selected.length >= maxKeywords) break;
    if (!selected.includes(keyword)) {
      selected.push(keyword);
    }
  }

  console.log(`[IntentKeywords] Selected ${selected.length} top keywords for SERP analysis`);
  return selected;
}
