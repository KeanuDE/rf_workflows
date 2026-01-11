import OpenAI from "openai";
import type { LocationFinderOutput, WorkflowInput } from "../types";
import { crawlWebsite } from "./crawler";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // Global timeout
});

const MODEL = "gpt-5-mini";

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
 * Entspricht dem "by description" Node im n8n Workflow
 */
export async function extractKeywordsFromDescription(
  description: string,
  _locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus dieser Beschreibung die wichtigsten Keywords rauszusuchen.

Bitte gib deine Antwort als JSON Array aus: {"keywords": ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]}

Maximal 20 Keywords.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: description },
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
 * Keyword Extractor Agent (by company purpose)
 * Extrahiert Keywords aus den Services/USPs
 * Entspricht dem "by company purpose" Node im n8n Workflow
 */
export async function extractKeywordsFromServices(
  services: string,
  _locationCode: number
): Promise<string[]> {
  const systemPrompt = `Du bist ein SEO-Spezialist.

Deine Aufgabe ist es aus den USPs der Firma die wichtigsten Keywords rauszusuchen.

Bitte gib deine Antwort als JSON Array aus: {"keywords": ["Keyword1","Keyword2","Keyword3","Keyword4","Keyword5","Keyword6","Keyword7","Keyword8",...]}

Maximal 20 Keywords.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: services },
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
