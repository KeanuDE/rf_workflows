import { ApifyClient } from "apify-client";
import OpenAI from "openai";
import type { CrawlerInput, CrawlerOutput } from "../types";

/**
 * Crawler Tool Service
 * Crawlt eine Website mit Apify und extrahiert relevante Infos mit KI-Agent
 * Entspricht dem "Crawler Tool" Workflow in n8n
 * 
 * Flow:
 * 1. Apify Website Scraper (playwright:firefox) -> HTML
 * 2. HTML zu Markdown konvertieren
 * 3. KI-Agent extrahiert die gewünschten Informationen
 */

function getApifyClient(): ApifyClient {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("APIFY_API_TOKEN must be set in environment variables");
  }
  return new ApifyClient({ token });
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set in environment variables");
  }
  return new OpenAI({ apiKey });
}

/**
 * HTML zu Markdown/Text konvertieren
 * Entspricht dem "Markdown" Node im n8n Workflow
 */
function htmlToText(html: string): string {
  return html
    // Script und Style Tags entfernen
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    // Überschriften zu Markdown
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    // Paragraphen
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    // Listen
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    // Zeilenumbrüche
    .replace(/<br\s*\/?>/gi, "\n")
    // Restliche HTML Tags entfernen
    .replace(/<[^>]+>/g, " ")
    // HTML Entities dekodieren
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    // Mehrfache Leerzeichen und Newlines reduzieren
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

/**
 * Scrape Website mit Apify Web Scraper (playwright:firefox)
 * Entspricht dem "Apify1" Node im n8n Workflow
 */
async function scrapeWithApify(url: string): Promise<string> {
  const client = getApifyClient();

  console.log(`Scraping ${url} with Apify (playwright:firefox)...`);

  // Web Scraper Actor mit playwright:firefox
  // https://apify.com/apify/web-scraper
  const run = await client.actor("apify/web-scraper").call({
    startUrls: [{ url }],
    pageFunction: `
      async function pageFunction(context) {
        const $ = context.jQuery;
        const html = $('body').html() || '';
        return {
          url: context.request.url,
          html: html
        };
      }
    `,
    proxyConfiguration: {
      useApifyProxy: true,
    },
    maxCrawlPages: 1,
    maxCrawlDepth: 0,
  });

  // Get results from the dataset
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (items.length === 0 || !items[0]) {
    console.warn("No content found from Apify scraper");
    return "";
  }

  const html = (items[0] as Record<string, unknown>).html as string || "";
  console.log(`Scraped ${html.length} characters HTML from ${url}`);

  return html;
}

/**
 * KI-Agent extrahiert relevante Informationen aus dem Website-Content
 * Entspricht dem "AI Agent" Node im n8n Workflow
 */
async function extractWithAI(content: string, what: string): Promise<string> {
  const openai = getOpenAI();

  const systemPrompt = `Du bist dafür verantwortlich die wichtigsten Daten, die dein Nutzer benötigt aus dem Kontext zu extrahieren. Dafür bekommst du vom Nutzer den Website Quellcode. Gebe den Nutzer nur die Infos raus die du findest. Der Nutzer schreibt auch dazu was genau er sucht.`;

  const userPrompt = `${content}\n\nBitte finde: ${what}`;

  console.log(`Extracting info with AI: "${what.substring(0, 50)}..."`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt.substring(0, 30000) }, // Limit content
    ],
  });

  const result = response.choices[0]?.message?.content || "";
  console.log(`AI extracted ${result.length} characters`);

  return result;
}

/**
 * Hauptfunktion: Crawlt Website und extrahiert Informationen
 * Entspricht dem kompletten "Crawler Tool" Workflow in n8n
 */
export async function crawlWebsite(input: CrawlerInput): Promise<CrawlerOutput> {
  try {
    // Step 1: Scrape mit Apify
    let html = await scrapeWithApify(input.url);

    // Wenn HTML leer oder Fehler (403, Forbidden), versuche mit http statt https
    if (!html || html.includes("403") || html.includes("Forbidden")) {
      const httpUrl = input.url.replace("https", "http");
      console.log(`Retrying with HTTP: ${httpUrl}`);
      html = await scrapeWithApify(httpUrl);
    }

    if (!html) {
      console.warn("No HTML content scraped");
      return { content: "" };
    }

    // Step 2: HTML zu Markdown/Text konvertieren
    const markdown = htmlToText(html);

    // Step 3: Wenn "what" angegeben, KI-Agent nutzen um relevante Infos zu extrahieren
    if (input.what && input.what.trim()) {
      const extracted = await extractWithAI(markdown, input.what);
      return { content: extracted };
    }

    // Sonst einfach den konvertierten Text zurückgeben
    return { content: markdown.substring(0, 15000) };
  } catch (error) {
    console.error("Crawler error:", error);
    return { content: "" };
  }
}

/**
 * Einfache Variante ohne KI-Extraktion
 * Gibt nur den HTML-Content als Text zurück
 */
export async function crawlWebsiteRaw(url: string): Promise<string> {
  try {
    const html = await scrapeWithApify(url);
    return htmlToText(html);
  } catch (error) {
    console.error("Raw crawler error:", error);
    return "";
  }
}
