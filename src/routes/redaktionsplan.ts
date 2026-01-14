import { Elysia, t } from "elysia";
import { runRedaktionsplanWorkflow } from "../services/redaktionsplan";
import type { RedaktionsplanInput } from "../services/supabase";

const RedaktionsplanInputSchema = t.Object({
  customer_id: t.String(),
  package: t.Union([t.Literal("starter"), t.Literal("professional"), t.Literal("enterprise")]),
  action: t.String(),
  feedback: t.Optional(t.String()),
});

export const redaktionsplanRoutes = new Elysia({ prefix: "/redaktionsplan" })
  .post(
    "/",
    async ({ body }) => {
      try {
        console.log(`[Redaktionsplan] POST request for customer: ${body.customer_id}`);
        
        const result = await runRedaktionsplanWorkflow(body as RedaktionsplanInput);
        
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error("[Redaktionsplan] Error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: RedaktionsplanInputSchema,
    }
  );
