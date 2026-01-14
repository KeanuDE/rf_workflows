import { Elysia } from "elysia";

export const indexRoutes = new Elysia({ prefix: "/" })
  .get("/", () => ({
    message: "SEO Keyword Research Workflow API",
    version: "1.0.0",
    endpoints: {
      "GET /": "API Info",
      "GET /health": "Health Check",
      "GET /debug/dataforseo": "DataForSEO Test",
      "POST /workflow": "Run SEO keyword research workflow (accepts single object or array)",
    },
  }));
