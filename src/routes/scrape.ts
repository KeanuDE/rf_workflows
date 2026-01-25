import { Elysia, t } from "elysia";
import { scrapeWebsiteDetailed } from "../services/scraper";

// Input Schema - "company" wie im Original n8n Script
const ScrapeInputSchema = t.Object({
  company: t.String(), // URL der Website
});

export const scrapeRoutes = new Elysia({ prefix: "/scrape" }).post(
  "/",
  async ({ body }) => {
    console.log(`[Route /scrape] Incoming request for: ${body.company}`);

    try {
      const result = await scrapeWebsiteDetailed(body);

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error("[Route /scrape] Error:", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        startUrl: body.company,
        finalUrl: null,
        hadRedirect: false,
        body: "",
        footer: "",
        links: [],
        css: "",
        cssLinks: [],
      };
    }
  },
  { body: ScrapeInputSchema }
);
