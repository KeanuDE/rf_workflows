import type { ScraperInput, ScraperOutput } from "../types";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";

// Browserless WebSocket Endpoint
const BROWSERLESS_WS_ENDPOINT =
  process.env.BROWSERLESS_WS_ENDPOINT ||
  "ws://browserless:3000/?token=6R0W53R135510";

// Retry-Konfiguration
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 Sekunden Basis-Delay

// Extrahiert aussagekräftige Fehlermeldung aus verschiedenen Error-Typen
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  
  const errorEvent = error as { error?: Error; message?: string; toString?: () => string } | null;
  if (errorEvent?.error instanceof Error) {
    return errorEvent.error.message;
  }
  
  if (errorEvent?.message) {
    return errorEvent.message;
  }
  
  return String(error);
}

// Prüft ob es ein Connection-Error ist, der einen Retry rechtfertigt
function isConnectionError(error: unknown): boolean {
  const errorMessage = getErrorMessage(error);
  const errorCode = (error as { code?: string })?.code || "";

  return (
    errorCode === "ECONNRESET" ||
    errorMessage.includes("ECONNRESET") ||
    errorMessage.includes("WebSocket") ||
    errorMessage.includes("connection") ||
    errorMessage.includes("Connection timeout") ||
    errorMessage.includes("Protocol error")
  );
}

/**
 * Scraped eine Website und extrahiert detaillierte Informationen:
 * - Body HTML, Footer HTML
 * - Alle Links (dedupliziert)
 * - CSS Rules und externe Stylesheet-Links
 * - Redirect-Information
 */
export async function scrapeWebsiteDetailed(
  input: ScraperInput,
  retryCount = 0
): Promise<ScraperOutput> {
  const startUrl = input.company;
  let browser: Browser | null = null;
  let page: Page | null = null;

  console.log(`[Scraper] Scraping website: ${startUrl}`);

  try {
    // Browser-Verbindung mit Timeout
    browser = await Promise.race([
      puppeteer.connect({
        browserWSEndpoint: BROWSERLESS_WS_ENDPOINT,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Browser connection timeout after 15s")),
          15000
        )
      ),
    ]);

    page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    // Navigation mit networkidle0 (wie im Original-Script)
    await page.goto(startUrl, { waitUntil: "networkidle0" });

    // Finale URL nach Redirects
    const finalUrl = page.url();
    const hadRedirect = startUrl !== finalUrl;

    if (hadRedirect) {
      console.log(`[Scraper] Redirect detected: ${startUrl} -> ${finalUrl}`);
    }

    // DOM-Extraktion via page.evaluate() - String IIFE um TypeScript DOM-Fehler zu vermeiden
    const result = (await page.evaluate(`
      (() => {
        const body = document.body ? document.body.outerHTML : "";
        const footerElem = document.querySelector("footer");
        const footer = footerElem ? footerElem.outerHTML : "";

        // Alle <a>-Tags im Body
        const bodyLinks = Array.from(document.body.querySelectorAll("a")).map(a => a.href);
        // Alle <a>-Tags im Footer
        const footerLinks = footerElem
          ? Array.from(footerElem.querySelectorAll("a")).map(a => a.href)
          : [];
        // Kombiniere und dedupliziere Links
        const links = Array.from(new Set([...bodyLinks, ...footerLinks]));

        // CSS crawlen (graceful - Fehler ignorieren)
        const css = Array.from(document.styleSheets)
          .filter(sheet => {
            try {
              return sheet.cssRules; // Prüfen ob zugänglich
            } catch (e) {
              return false; // Cross-origin Stylesheets ignorieren
            }
          })
          .map(sheet => {
            try {
              return Array.from(sheet.cssRules)
                .map(rule => rule.cssText)
                .join("\\n");
            } catch (e) {
              return "";
            }
          })
          .join("\\n\\n");

        // Externe CSS-Links
        const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .map(link => link.href);

        return { body, footer, links, css, cssLinks };
      })()
    `)) as { body: string; footer: string; links: string[]; css: string; cssLinks: string[] };

    console.log(
      `[Scraper] Successfully scraped: ${finalUrl} (${result.links.length} links, ${result.cssLinks.length} CSS files)`
    );

    return {
      ...result,
      hadRedirect,
      startUrl,
      finalUrl,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`[Scraper] Error scraping ${startUrl}:`, errorMessage);

    // Retry bei Connection-Errors
    if (isConnectionError(error) && retryCount < MAX_RETRIES) {
      const backoffDelay = RETRY_DELAY * Math.pow(2, retryCount);
      console.warn(
        `[Scraper] Connection error, retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`
      );
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return scrapeWebsiteDetailed(input, retryCount + 1);
    }

    // Keine Retries mehr oder kein Connection-Error
    throw new Error(`Failed to scrape ${startUrl}: ${errorMessage}`);
  } finally {
    // Cleanup
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
    if (browser) {
      try {
        await browser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  }
}
