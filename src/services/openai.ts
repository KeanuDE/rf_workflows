import OpenAI from "openai";
import type { LocationFinderOutput, WorkflowInput, CrawlerInput, CrawlerOutput } from "../types";
import { crawlWebsite } from "./crawler";
import { getSERPResults } from "./dataforseo";

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
 * Prüft ob eine URL eine einzelne Firma oder ein Branchenportal ist
 * Nutzt KI um den Content zu analysieren
 */
export async function isSingleCompanyWebsite(url: string): Promise<boolean> {
  console.log(`[CompanyValidator] Checking if "${url}" is a single company website...`);

  try {
    const crawlResult = await crawlWebsite({
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
    
    console.log(`[CompanyValidator] Result for ${url}: isSingleCompany=${isSingle}, reason=${parsed.reason}`);
    return isSingle;

  } catch (error) {
    console.error(`[CompanyValidator] Error checking ${url}:`, error);
    return isCompanyByHeuristics(url);
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

    console.log(`[CompanyValidator] [Heuristic] ${url} ambiguous, defaulting to true`);
    return true;

  } catch {
    return true;
  }
}

/**
 * Validiert mehrere Domains mit Batch-Parallelisierung
 * Gibt zurück welche Domains echte Unternehmen sind
 */
export async function validateCompanyDomains(
  domains: Array<{ domain: string; rank: number }>
): Promise<Array<{ domain: string; rank: number }>> {
  console.log(`[CompanyValidator] Validating ${domains.length} domains...`);

  if (domains.length === 0) {
    return [];
  }

  // Process domains in batches of 3 for better performance while respecting rate limits
  const BATCH_SIZE = 3;
  const validCompanies: Array<{ domain: string; rank: number }> = [];

  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel with staggered start times
    const batchPromises = batch.map(async (item, index) => {
      // Stagger by 400ms to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, index * 400));
      
      const isCompany = await isSingleCompanyWebsite(item.domain);
      
      if (isCompany) {
        return item;
      } else {
        console.log(`[CompanyValidator] Filtered out portal: ${item.domain}`);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    validCompanies.push(...batchResults.filter((item): item is { domain: string; rank: number } => item !== null));

    // Wait 1s between batches
    if (i + BATCH_SIZE < domains.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`[CompanyValidator] Validated: ${validCompanies.length}/${domains.length} are companies`);
  return validCompanies;
}
