import { Elysia } from "elysia";
import { indexRoutes } from "./src/routes/index";
import { healthRoutes } from "./src/routes/health";
import { debugRoutes } from "./src/routes/debug";
import { workflowRoutes } from "./src/routes/workflow";

const port = process.env.PORT || 3000;

const app = new Elysia()
  .use(indexRoutes)
  .use(healthRoutes)
  .use(debugRoutes)
  .use(workflowRoutes)
  .listen(port);

console.log(
  `SEO Keyword Research API is running at ${app.server?.hostname}:${app.server?.port}`
);

export type App = typeof app;
