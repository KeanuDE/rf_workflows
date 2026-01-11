import OpenAI from "openai";
import type { LocationFinderOutput, WorkflowInput } from "../types";
import { crawlWebsite } from "./crawler";
import { getSERPResults } from "./dataforseo";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // Global timeout
});

const MODEL = "gpt-5-mini";

/**
 * Tool Definition für Keyword-Validierung via DataForSEO SERP
 * Entspricht dem Tool-Workflow in n8n der /serp/google/organic/live/regular aufruft
 */
const keywordValidationTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "check_keyword_serp",
    description: "Prüft ein Keyword bei Google SERP um zu sehen wie gut es rankt und ob es relevant ist. Gibt die Top-Ergebnisse zurück.",
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
 * Führt das SERP-Tool aus
 * Entspricht dem HTTP Request Node im n8n Tool-Workflow
 */
async function executeKeywordTool(
  keyword: string,
  locationCode: number
): Promise<string> {
  try {
    console.log(`[OpenAI Tool] Checking SERP for keyword: "${keyword}"`);
    
    const serpResponse = await getSERPResults(keyword, locationCode);
    const items = serpResponse.tasks?.[0]?.result?.[0]?.items || [];
    
    // Formatiere die Ergebnisse für den Agent
    const topResults = items.slice(0, 5).map((item, index) => ({
      rank: index + 1,
      url: item.url,
      domain: item.domain || new URL(item.url).hostname,
    }));
    
    const resultCount = items.length;
    
    return JSON.stringify({
      keyword,
      total_results: resultCount,
      has_competition: resultCount > 0,
      top_results: topResults,
      recommendation: resultCount > 0 
        ? "Keyword hat Suchergebnisse und ist relevant" 
        : "Keyword hat keine Suchergebnisse",
    });
  } catch (error) {
    console.error(`[OpenAI Tool] Error checking keyword "${keyword}":`, error);
    return JSON.stringify({
      keyword,
      error: "Konnte Keyword nicht prüfen",
      recommendation: "Keyword trotzdem verwenden",
    });
  }
}

/**
 * Verarbeitet Tool-Calls vom Agent
 */
async function processToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  locationCode: number
): Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam[]> {
  const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];
  
  for (const toolCall of toolCalls) {
    // Type guard für function tool calls
    if (toolCall.type === "function" && "function" in toolCall) {
      const functionCall = toolCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
      
      if (functionCall.function.name === "check_keyword_serp") {
        const args = JSON.parse(functionCall.function.arguments);
        const result = await executeKeywordTool(args.keyword, locationCode);
        
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
 * Führt einen Agent mit Tool-Unterstützung aus
 * Iteriert bis der Agent keine Tools mehr aufruft
 */
async function runAgentWithTools(
  systemPrompt: string,
  userPrompt: string,
  locationCode: number,
  maxIterations: number = 10
): Promise<string[]> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let iterations = 0;
  
  while (iterations < maxIterations) {
    iterations++;
    console.log(`[OpenAI Agent] Iteration ${iterations}...`);
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: [keywordValidationTool],
      tool_choice: "auto",
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("No response from OpenAI");
    }

    // Füge die Antwort zu den Messages hinzu
    messages.push(assistantMessage);

    // Wenn keine Tool-Calls, ist der Agent fertig
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`[OpenAI Agent] Completed after ${iterations} iterations`);
      
      // Parse das finale Ergebnis
      const content = assistantMessage.content || "[]";
      try {
        // Versuche JSON zu parsen
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (parsed.keywords && Array.isArray(parsed.keywords)) {
          return parsed.keywords;
        }
      } catch {
        // Versuche Array aus dem Text zu extrahieren
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            return JSON.parse(arrayMatch[0]);
          } catch {
            console.warn("[OpenAI Agent] Could not parse array from response");
          }
        }
      }
      return [];
    }

    // Führe die Tools aus
    console.log(`[OpenAI Agent] Executing ${assistantMessage.tool_calls.length} tool calls...`);
    const toolResults = await processToolCalls(assistantMessage.tool_calls, locationCode);
    
    // Füge die Tool-Ergebnisse zu den Messages hinzu
    messages.push(...toolResults);
  }

  console.warn(`[OpenAI Agent] Max iterations (${maxIterations}) reached`);
  return [];
}

/**
 * Location-Finder Agent
 * Sucht auf der Website nach Branche und Standort
 * Entspricht dem "Location-Finder" Node im n8n Workflow
 */
export async function findLocationAndGenre(
  input: WorkflowInput
): Promise<LocationFinderOutput> {
  const systemPrompt = `Suche auf der Website nach Branche und Standort. Gebe bei Location wirklich nur die Stadt an. Gebe bei fullLocation die Stadt mit Bundesland (auf Englisch) an.

Du hast Zugriff auf ein Tool um Websites zu crawlen. Nutze es wenn nötig.

Antworte IMMER im folgenden JSON Format:
{
  "location": "STADT",
  "fullLocation": "STADT, BUNDESLAND",
  "genre": "BRANCHE"
}`;

  const userPrompt = `URL:
${input.website}
Firmenbeschreibung:
${input.company_purpose.description}`;

  // Erst versuchen ohne Crawling
  let websiteContent = "";
  
  try {
    // Website crawlen für mehr Kontext
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
 * MIT Tool-Unterstützung für SERP-Validierung
 * Entspricht dem "by description" Node im n8n Workflow
 */
export async function extractKeywordsFromDescription(
  description: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus dieser Beschreibung die wichtigsten Keywords rauszusuchen.

Nutz das mitgegebene Tool um zu validieren, wie gut das Keyword ist. Prüfe mindestens 5-10 Keywords bevor du deine finale Liste erstellst.

Bitte gib deine Antwort als Array aus: ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]

Maximal 20 Keywords. Nur Keywords die bei der SERP-Prüfung gute Ergebnisse hatten.`;

  console.log(`[OpenAI] Extracting keywords from description (${description.length} chars)...`);
  
  return runAgentWithTools(systemPrompt, description, locationCode);
}

/**
 * Keyword Extractor Agent (by company purpose)
 * Extrahiert Keywords aus den Services/USPs
 * MIT Tool-Unterstützung für SERP-Validierung
 * Entspricht dem "by company purpose" Node im n8n Workflow
 */
export async function extractKeywordsFromServices(
  services: string,
  locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus den USPs der Firma die wichtigsten Keywords rauszusuchen.

Nutz das mitgegebene Tool um zu validieren, wie gut das Keyword ist. Prüfe mindestens 5-10 Keywords bevor du deine finale Liste erstellst.

Bitte gib deine Antwort als Array aus: ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]

Maximal 20 Keywords. Nur Keywords die bei der SERP-Prüfung gute Ergebnisse hatten.`;

  console.log(`[OpenAI] Extracting keywords from services (${services.length} chars)...`);
  
  return runAgentWithTools(systemPrompt, services, locationCode);
}

/**
 * Keyword Searcher Agent
 * Generiert lokale SEO-Synonyme zu Keywords
 * Entspricht dem "Keyword searcher" Node im n8n Workflow
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
 * Entspricht dem "Keyword validator" Node im n8n Workflow
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
