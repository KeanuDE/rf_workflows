import { Elysia, t } from "elysia";
import { findLocation, getKeywordSearchVolume } from "../services/dataforseo";

export const debugRoutes = new Elysia({ prefix: "/debug" })
  .get("/dataforseo", async () => {
    try {
      console.log("Testing DataForSEO location lookup...");
      const locationCode = await findLocation("Minden, North Rhine-Westphalia", "Minden");
      
      console.log("Testing DataForSEO search volume...");
      const testKeywords = ["Heizung Minden", "Sanitär Minden", "Badezimmer Minden"];
      const volumeResult = await getKeywordSearchVolume(testKeywords, locationCode || 2276);
      
      return {
        success: true,
        location: {
          searchTerm: "Minden, North Rhine-Westphalia",
          city: "Minden",
          code: locationCode,
        },
        searchVolume: {
          requested: testKeywords,
          received: volumeResult.length,
          data: volumeResult.map(k => ({
            keyword: k.keyword,
            volume: k.search_volume,
          })),
        },
      };
    } catch (error) {
      console.error("DataForSEO test error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      };
    }
  });
