import OpenAI from "openai";
import type { LocationFinderOutput, WorkflowInput } from "../types";
import { crawlWebsite } from "./crawler";
import { getSERPResults } from "./dataforseo";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
});

const MODEL = "gpt-4o-mini";

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
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus dieser Beschreibung die wichtigsten Keywords rauszusuchen.

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
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus den USPs der Firma die wichtigsten Keywords rauszusuchen.

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
