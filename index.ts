import { Elysia, t } from "elysia";
import { runSEOKeywordWorkflow } from "./src/services/workflow";
import { findLocation, getKeywordSearchVolume } from "./src/services/dataforseo";
import type { WorkflowInput } from "./src/types";

const port = process.env.PORT || 3000;

// Schema für einen einzelnen Workflow Input
const WorkflowInputSchema = t.Object({
  id: t.String(),
  onboarding_session_id: t.String(),
  company_name: t.String(),
  industry: t.String(),
  industry_subcategory: t.String(),
  custom_subcategory: t.Optional(t.String()),
  location: t.String(),
  employee_count: t.Optional(t.String()),
  website: t.String(),
  description: t.String(),
  contact_salutation: t.Optional(t.String()),
  contact_first_name: t.Optional(t.String()),
  contact_last_name: t.Optional(t.String()),
  contact_email: t.Optional(t.String()),
  contact_phone: t.Optional(t.Union([t.String(), t.Null()])),
  facebook_profile: t.Optional(t.String()),
  instagram_profile: t.Optional(t.String()),
  linkedin_profile: t.Optional(t.String()),
  youtube_profile: t.Optional(t.String()),
  blog_url: t.Optional(t.String()),
  created_at: t.Optional(t.String()),
  updated_at: t.Optional(t.String()),
  tiktok_profile: t.Optional(t.String()),
  logo_url: t.Optional(t.String()),
  logo_background_color: t.Optional(t.String()),
  primary_color: t.Optional(t.String()),
  secondary_color: t.Optional(t.String()),
  accent_color: t.Optional(t.String()),
  background_color: t.Optional(t.String()),
  text_color: t.Optional(t.String()),
  company_purpose: t.Object({
    services: t.Array(
      t.Object({
        name: t.String(),
        category: t.String(),
        description: t.String(),
      })
    ),
    description: t.String(),
    business_model: t.Object({
      type: t.String(),
      description: t.String(),
    }),
  }),
  target_audience: t.Optional(t.Array(t.String())),
  usps: t.Optional(t.Array(t.String())),
  operating_region: t.Optional(t.String()),
});

const app = new Elysia()
  .get("/", () => ({
    message: "SEO Keyword Research Workflow API",
    version: "1.0.0",
    endpoints: {
      "POST /workflow": "Run SEO keyword research workflow (accepts single object or array)",
      "GET /health": "Health check",
    },
  }))
  .get("/health", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasDataForSEO: !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD,
      hasApify: !!process.env.APIFY_API_TOKEN,
    },
  }))
  // Debug endpoint to test DataForSEO
  .get("/debug/dataforseo", async () => {
    try {
      // Test 1: Location lookup
      console.log("Testing DataForSEO location lookup...");
      const locationCode = await findLocation("Berlin, Berlin");
      
      // Test 2: Search volume
      console.log("Testing DataForSEO search volume...");
      const testKeywords = ["Liveband", "Hochzeitsband", "Partyband"];
      const volumeResult = await getKeywordSearchVolume(testKeywords, locationCode || 2276);
      
      return {
        success: true,
        location: {
          searchTerm: "Berlin, Berlin",
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
  })
  // Endpoint für Array Input (wie von n8n)
  .post(
    "/workflow",
    async ({ body }) => {
      try {
        // Normalisiere Input: Array oder einzelnes Objekt
        const inputs = Array.isArray(body) ? body : [body];
        
        console.log(`Starting workflow for ${inputs.length} company/companies`);
        
        const results = [];
        
        for (const input of inputs) {
          console.log(`Processing: ${input.company_name}`);
          try {
            const result = await runSEOKeywordWorkflow(input as WorkflowInput);
            results.push({
              success: true,
              company_name: input.company_name,
              id: input.id,
              data: result,
            });
          } catch (error) {
            console.error(`Error for ${input.company_name}:`, error);
            results.push({
              success: false,
              company_name: input.company_name,
              id: input.id,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }
        
        // Wenn nur ein Input, gib direkt das Ergebnis zurück
        if (results.length === 1) {
          return results[0];
        }
        
        return {
          success: results.every(r => r.success),
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          results,
        };
      } catch (error) {
        console.error("Workflow error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Union([
        t.Array(WorkflowInputSchema),
        WorkflowInputSchema,
      ]),
    }
  )
  .listen(port);

console.log(
  `SEO Keyword Research API is running at ${app.server?.hostname}:${app.server?.port}`
);

export type App = typeof app;
