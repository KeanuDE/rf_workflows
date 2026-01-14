import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/health" })
  .get("/", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasDataForSEO: !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD,
      hasApify: !!process.env.APIFY_API_TOKEN,
    },
  }));
