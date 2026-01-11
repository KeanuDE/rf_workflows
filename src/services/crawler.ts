import puppeteer from "puppeteer-core";
import { ApifyClient } from "apify-client";
import OpenAI from "openai";
import type { CrawlerInput, CrawlerOutput } from "../types";

/**
 * Crawler Tool Service
 * Crawlt eine Website zuerst mit Puppeteer (browserless), dann Apify als Fallback
 * Entspricht dem "Crawler Tool" Workflow in n8n
 * 
 * Flow (wie in n8n):
 * 1. Puppeteer über WebSocket (browserless) versuchen
 * 2. Bei SSL-Fehlern: URL zu http ändern und Apify nutzen
 * 3. Bei 403/Forbidden: Apify als Fallback
 * 4. HTML zu Markdown konvertieren
 * 5. KI-Agent extrahiert die gewünschten Informationen
 */

// Browserless WebSocket URL
const BROWSERLESS_WS_ENDPOINT = process.env.BROWSERLESS_WS_ENDPOINT || "ws://browserless:3000/?token=6R0W53R135510";

// SSL-Fehler die einen http-Fallback auslösen
const SSL_ERRORS = [
  "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
  "ERR_CERT_COMMON_NAME_INVALID",
  "ERR_SSL_PROTOCOL_ERROR",
  "ERR_CERT_DATE_INVALID",
];

interface PuppeteerResult {
  body: string;
  footer: string;
  error?: string;
}

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
 * Prüft ob ein Fehler ein SSL-Fehler ist
 */
function isSSLError(error: string): boolean {
  return SSL_ERRORS.some(sslErr => error.includes(sslErr));
}

/**
 * Prüft ob der Content einen 403/Forbidden-Fehler enthält
 */
function isForbiddenResponse(content: string): boolean {
  return content.includes("403") || content.toLowerCase().includes("forbidden");
}

/**
 * Scrape Website mit Puppeteer über WebSocket (browserless)
 * Entspricht dem "Puppeteer1" Node im n8n Workflow
 */
async function scrapeWithPuppeteer(url: string): Promise<PuppeteerResult> {
  console.log(`[Crawler] Scraping with Puppeteer (browserless): ${url}`);
  
  let browser;
  try {
    // Verbinde zu browserless über WebSocket
    browser = await puppeteer.connect({
      browserWSEndpoint: BROWSERLESS_WS_ENDPOINT,
    });

    const page = await browser.newPage();
    
    // Timeout setzen
    page.setDefaultNavigationTimeout(30000);
    
    // Navigiere zur URL
    await page.goto(url, { waitUntil: "networkidle2" });

    // Extrahiere body und footer (wie im n8n Script)
    const result = await page.evaluate(`
      (() => {
        const body = document.body ? document.body.outerHTML : "";
        const footer = document.querySelector("footer") ? document.querySelector("footer").outerHTML : "";
        return { body, footer };
      })()
    `) as { body: string; footer: string };

    console.log(`[Crawler] Puppeteer scraped ${result.body.length} chars from ${url}`);
    
    await page.close();
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Crawler] Puppeteer error for ${url}:`, errorMessage);
    return { body: "", footer: "", error: errorMessage };
  } finally {
    if (browser) {
      try {
        await browser.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

/**
 * Scrape Website mit Apify Web Scraper (playwright:firefox)
 * Entspricht dem "Apify1" Node im n8n Workflow
 */
async function scrapeWithApify(url: string): Promise<string> {
  const client = getApifyClient();

  console.log(`[Crawler] Scraping with Apify (playwright:firefox): ${url}`);

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
    console.warn("[Crawler] No content found from Apify scraper");
    return "";
  }

  const html = (items[0] as Record<string, unknown>).html as string || "";
  console.log(`[Crawler] Apify scraped ${html.length} chars from ${url}`);

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

  console.log(`[Crawler] Extracting with AI: "${what.substring(0, 50)}..."`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt.substring(0, 30000) }, // Limit content
    ],
  });

  const result = response.choices[0]?.message?.content || "";
  console.log(`[Crawler] AI extracted ${result.length} chars`);

  return result;
}

/**
 * Hauptfunktion: Crawlt Website und extrahiert Informationen
 * Entspricht dem kompletten "Crawler Tool" Workflow in n8n
 * 
 * Flow:
 * 1. 2 Sekunden warten (wie Wait Node in n8n)
 * 2. Puppeteer versuchen
 * 3. Bei SSL-Fehler: URL zu http ändern und Apify nutzen
 * 4. Bei 403/Forbidden oder leerem Ergebnis: Apify als Fallback
 * 5. HTML zu Markdown konvertieren
 * 6. KI-Agent extrahiert die gewünschten Informationen
 */
export async function crawlWebsite(input: CrawlerInput): Promise<CrawlerOutput> {
  try {
    // Step 1: 2 Sekunden warten (wie Wait Node in n8n)
    console.log(`[Crawler] Starting crawl for: ${input.url}`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    let html = "";
    let usedMethod = "";

    // Step 2: Versuche zuerst mit Puppeteer
    const puppeteerResult = await scrapeWithPuppeteer(input.url);

    if (puppeteerResult.error) {
      // Step 3: Bei SSL-Fehler, versuche mit http und Apify
      if (isSSLError(puppeteerResult.error)) {
        console.log(`[Crawler] SSL error detected, trying with http via Apify...`);
        const httpUrl = input.url.replace("https://", "http://");
        html = await scrapeWithApify(httpUrl);
        usedMethod = "apify (http fallback)";
      } else {
        // Anderer Fehler: Apify als Fallback
        console.log(`[Crawler] Puppeteer failed, falling back to Apify...`);
        html = await scrapeWithApify(input.url);
        usedMethod = "apify (fallback)";
      }
    } else if (!puppeteerResult.body || isForbiddenResponse(puppeteerResult.body)) {
      // Step 4: Bei 403/Forbidden oder leerem Ergebnis: Apify Fallback
      console.log(`[Crawler] Puppeteer returned empty or forbidden, falling back to Apify...`);
      html = await scrapeWithApify(input.url);
      usedMethod = "apify (403 fallback)";
    } else {
      // Puppeteer war erfolgreich
      html = puppeteerResult.body;
      usedMethod = "puppeteer";
    }

    console.log(`[Crawler] Scraped via ${usedMethod}: ${html.length} chars`);

    // Wenn Apify auch leer oder 403, versuche mit http
    if ((!html || isForbiddenResponse(html)) && usedMethod.includes("apify") && !usedMethod.includes("http")) {
      console.log(`[Crawler] Apify also failed, trying http...`);
      const httpUrl = input.url.replace("https://", "http://");
      html = await scrapeWithApify(httpUrl);
      usedMethod = "apify (http retry)";
    }

    if (!html) {
      console.warn("[Crawler] No HTML content scraped from any method");
      return { content: "" };
    }

    // Step 5: HTML zu Markdown/Text konvertieren
    const markdown = htmlToText(html);
    console.log(`[Crawler] Converted to ${markdown.length} chars markdown`);

    // Step 6: Wenn "what" angegeben, KI-Agent nutzen um relevante Infos zu extrahieren
    if (input.what && input.what.trim()) {
      const extracted = await extractWithAI(markdown, input.what);
      return { content: extracted };
    }

    // Sonst einfach den konvertierten Text zurückgeben
    return { content: markdown.substring(0, 15000) };
  } catch (error) {
    console.error("[Crawler] Error:", error);
    return { content: "" };
  }
}

/**
 * Einfache Variante ohne KI-Extraktion
 * Gibt nur den HTML-Content als Text zurück
 */
export async function crawlWebsiteRaw(url: string): Promise<string> {
  try {
    console.log(`[Crawler] Raw crawl for: ${url}`);
    
    // Versuche zuerst Puppeteer
    const puppeteerResult = await scrapeWithPuppeteer(url);
    
    if (puppeteerResult.body && !isForbiddenResponse(puppeteerResult.body)) {
      return htmlToText(puppeteerResult.body);
    }
    
    // Fallback zu Apify
    console.log(`[Crawler] Raw crawl falling back to Apify...`);
    const html = await scrapeWithApify(url);
    return htmlToText(html);
  } catch (error) {
    console.error("[Crawler] Raw crawler error:", error);
    return "";
  }
}
