import OpenAI from "openai";
import type { LocationFinderOutput, WorkflowInput } from "../types";
import { crawlWebsite } from "./crawler";
import { getKeywordSearchVolume } from "./dataforseo";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
});

const MODEL = "gpt-4o-mini";

/**
 * Tool Definition für Keyword Search Volume Check
 * Nutzt /keywords_data/google_ads/search_volume/live
 */
const checkSearchVolumeTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "check_search_volume",
    description: "Prüft das monatliche Suchvolumen für ein oder mehrere Keywords bei Google. Gibt zurück wie oft pro Monat nach dem Keyword gesucht wird. Keywords mit höherem Suchvolumen sind wertvoller für SEO.",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Liste von Keywords die geprüft werden sollen (max 10 pro Anfrage)",
        },
      },
      required: ["keywords"],
    },
  },
};

/**
 * Speicher für den Agent - merkt sich bereits geprüfte Keywords
 */
interface AgentMemory {
  checkedKeywords: Map<string, number | null>; // keyword -> search_volume
  goodKeywords: string[]; // Keywords mit Suchvolumen > 0
  locationCode: number;
}

/**
 * Führt das Search Volume Tool aus
 * Nutzt /keywords_data/google_ads/search_volume/live
 */
async function executeSearchVolumeTool(
  keywords: string[],
  memory: AgentMemory
): Promise<string> {
  try {
    // Filtere bereits geprüfte Keywords
    const newKeywords = keywords.filter(kw => !memory.checkedKeywords.has(kw.toLowerCase()));
    
    if (newKeywords.length === 0) {
      // Alle Keywords wurden bereits geprüft - gib gecachte Ergebnisse zurück
      const cachedResults = keywords.map(kw => ({
        keyword: kw,
        search_volume: memory.checkedKeywords.get(kw.toLowerCase()) || 0,
        cached: true,
      }));
      return JSON.stringify({
        results: cachedResults,
        message: "Alle Keywords waren bereits geprüft (aus Cache)",
      });
    }

    console.log(`[Agent Tool] Checking search volume for ${newKeywords.length} new keywords...`);
    
    const results = await getKeywordSearchVolume(newKeywords, memory.locationCode);
    
    // Speichere Ergebnisse im Memory
    const formattedResults = [];
    for (const result of results) {
      const volume = result.search_volume || 0;
      memory.checkedKeywords.set(result.keyword.toLowerCase(), volume);
      
      if (volume > 0) {
        memory.goodKeywords.push(result.keyword);
      }
      
      formattedResults.push({
        keyword: result.keyword,
        search_volume: volume,
        competition: result.competition || "unknown",
        cpc: result.cpc || 0,
      });
    }

    // Sortiere nach Suchvolumen
    formattedResults.sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));

    const summary = {
      checked: formattedResults.length,
      with_volume: formattedResults.filter(r => r.search_volume > 0).length,
      without_volume: formattedResults.filter(r => !r.search_volume || r.search_volume === 0).length,
      results: formattedResults,
      tip: "Keywords mit search_volume > 0 sind gut für SEO. Je höher das Volumen, desto besser.",
    };

    return JSON.stringify(summary);
  } catch (error) {
    console.error(`[Agent Tool] Error checking search volume:`, error);
    return JSON.stringify({
      error: "Fehler beim Abrufen des Suchvolumens",
      message: error instanceof Error ? error.message : "Unknown error",
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
      
      if (functionCall.function.name === "check_search_volume") {
        const args = JSON.parse(functionCall.function.arguments);
        const keywords = args.keywords || [];
        
        // Limitiere auf 10 Keywords pro Anfrage
        const limitedKeywords = keywords.slice(0, 10);
        const result = await executeSearchVolumeTool(limitedKeywords, memory);
        
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
 * Der Agent kann mehrere Iterationen durchlaufen und sich Ergebnisse merken
 */
async function runKeywordResearchAgent(
  systemPrompt: string,
  userPrompt: string,
  locationCode: number,
  maxIterations: number = 15
): Promise<string[]> {
  // Initialisiere Agent Memory
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
    console.log(`[Agent] Iteration ${iterations}/${maxIterations} - Memory: ${memory.checkedKeywords.size} checked, ${memory.goodKeywords.length} good keywords`);
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: [checkSearchVolumeTool],
      tool_choice: iterations < 3 ? "required" : "auto", // Erste 3 Iterationen: Tool muss genutzt werden
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("No response from OpenAI");
    }

    messages.push(assistantMessage);

    // Wenn keine Tool-Calls, ist der Agent fertig
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[Agent] Completed after ${iterations} iterations`);
      console.log(`[Agent] Final memory: ${memory.checkedKeywords.size} keywords checked, ${memory.goodKeywords.length} with volume`);
      
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
    
    // Füge Memory-Status als Kontext hinzu nach jeder Tool-Nutzung
    if (iterations % 3 === 0 && memory.goodKeywords.length > 0) {
      messages.push({
        role: "system",
        content: `[Memory Update] Du hast bisher ${memory.checkedKeywords.size} Keywords geprüft. ${memory.goodKeywords.length} davon haben Suchvolumen: ${memory.goodKeywords.slice(0, 10).join(", ")}${memory.goodKeywords.length > 10 ? "..." : ""}`,
      });
    }
  }

  console.warn(`[Agent] Max iterations (${maxIterations}) reached`);
  
  // Gib die guten Keywords aus dem Memory zurück
  if (memory.goodKeywords.length > 0) {
    return memory.goodKeywords.slice(0, 20);
  }
  
  return [];
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
 * MIT Tool für Search Volume Prüfung
 */
export async function extractKeywordsFromDescription(
  description: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein erfahrener SEO-Spezialist und Keyword-Researcher.

DEINE AUFGABE:
Extrahiere die wichtigsten SEO-Keywords aus der gegebenen Firmenbeschreibung.

WICHTIG - RECHERCHE-PROZESS:
1. Lies die Beschreibung und identifiziere potenzielle Keywords
2. NUTZE DAS TOOL "check_search_volume" um das Suchvolumen zu prüfen
3. Prüfe verschiedene Variationen der Keywords (Singular/Plural, Synonyme)
4. Merke dir welche Keywords gutes Suchvolumen haben (> 0)
5. Recherchiere weiter bis du mindestens 10-15 Keywords mit Suchvolumen gefunden hast
6. Wenn ein Keyword kein Volumen hat, probiere Alternativen

REGELN:
- NUR Keywords mit nachgewiesenem Suchvolumen in die finale Liste
- Prüfe mindestens 20-30 verschiedene Keywords
- Deutsche Keywords bevorzugen
- Keine zu generischen Keywords (wie "Firma", "Service")
- Keine zu spezifischen Long-Tail Keywords

AUSGABE:
Wenn du genug recherchiert hast, gib deine finale Liste als JSON Array aus:
["Keyword1", "Keyword2", "Keyword3", ...]

Maximal 20 Keywords, alle mit nachgewiesenem Suchvolumen.`;

  console.log(`[OpenAI] Starting keyword research agent for description (${description.length} chars)...`);
  
  return runKeywordResearchAgent(systemPrompt, description, locationCode);
}

/**
 * Keyword Extractor Agent (by company purpose/services)
 * Extrahiert Keywords aus den Services/USPs
 * MIT Tool für Search Volume Prüfung
 */
export async function extractKeywordsFromServices(
  services: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein erfahrener SEO-Spezialist und Keyword-Researcher.

DEINE AUFGABE:
Extrahiere die wichtigsten SEO-Keywords aus den Services und USPs der Firma.

WICHTIG - RECHERCHE-PROZESS:
1. Analysiere die Services und identifiziere potenzielle Keywords
2. NUTZE DAS TOOL "check_search_volume" um das Suchvolumen zu prüfen
3. Prüfe verschiedene Variationen (z.B. "Webdesign", "Website erstellen", "Homepage")
4. Merke dir welche Keywords gutes Suchvolumen haben (> 0)
5. Recherchiere weiter bis du mindestens 10-15 Keywords mit Suchvolumen gefunden hast
6. Wenn ein Keyword kein Volumen hat, probiere Synonyme oder verwandte Begriffe

REGELN:
- NUR Keywords mit nachgewiesenem Suchvolumen in die finale Liste
- Prüfe mindestens 20-30 verschiedene Keywords
- Deutsche Keywords bevorzugen
- Fokus auf Service-bezogene Keywords
- Keine zu generischen Keywords

AUSGABE:
Wenn du genug recherchiert hast, gib deine finale Liste als JSON Array aus:
["Keyword1", "Keyword2", "Keyword3", ...]

Maximal 20 Keywords, alle mit nachgewiesenem Suchvolumen.`;

  console.log(`[OpenAI] Starting keyword research agent for services (${services.length} chars)...`);
  
  return runKeywordResearchAgent(systemPrompt, services, locationCode);
}

/**
 * Keyword Searcher Agent
 * Generiert lokale SEO-Synonyme zu Keywords
 */
export async function generateLocalSEOKeywords(
  keywords: string[],
  genre: string
): Promise<string[]> {
  const systemPrompt = `Aufgabe:
Erzeuge zu jedem der folgenden Keywords eine Liste relevanter lokaler SEO-Synonyme.
Kontext & Ziel:
Branche der Firma: ${genre}

Fokus auf lokale Suchanfragen in Deutschland
Nutzerintention: Dienstleistung / Anbieter vor Ort finden
Regeln:
- Verwende ausschließlich deutsche Begriffe
- Synonyme müssen inhaltlich gleichwertig sein
- Kombiniere Leistungs-, Anbieter- und Orts-Varianten
- Berücksichtige typische lokale Suchmuster wie:
„in der Nähe", „vor Ort", „in [Ort]", „regional", „lokal"
Berufs- und Dienstleisterbezeichnungen
- Keine Wiederholungen
- Keine Erklärungen oder Kommentare
- Es sollen einzelne Keywords in der Array sein.

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
 * Keyword Validator Agent
 * Überprüft ob Keywords zur Branche passen
 */
export async function validateKeywords(
  keywords: string[],
  genre: string
): Promise<string[]> {
  const systemPrompt = `Aufgabe:
Überprüfe ob die Keywords die du bekommen hast zu der Branche der Firma passen. Sollte es nicht der Fall sein entferne das Keyword aus der Liste und gebe dann die neue Liste mit den Keywords raus die Sinn machen.
Die Liste soll am Ende nur Sachen haben die in die Nische reinpassen, nichts generalisiertes

Branche der Firma: ${genre}
Regeln:
- Verwende ausschließlich deutsche Begriffe
- Die Keywords müssen Kontextmäßig zur Branche passen

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
