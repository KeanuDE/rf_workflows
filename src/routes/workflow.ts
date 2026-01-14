import { Elysia, t } from "elysia";
import { runSEOKeywordWorkflow } from "../services/workflow";
import type { WorkflowInput } from "../types";

const OptionalNullable = (schema: ReturnType<typeof t.String>) =>
  t.Optional(t.Union([schema, t.Null()]));

const WorkflowInputSchema = t.Object({
  id: t.String(),
  onboarding_session_id: t.String(),
  company_name: t.String(),
  industry: t.String(),
  industry_subcategory: t.String(),
  custom_subcategory: OptionalNullable(t.String()),
  location: t.String(),
  employee_count: OptionalNullable(t.String()),
  website: t.String(),
  description: t.String(),
  contact_salutation: OptionalNullable(t.String()),
  contact_first_name: OptionalNullable(t.String()),
  contact_last_name: OptionalNullable(t.String()),
  contact_email: OptionalNullable(t.String()),
  contact_phone: OptionalNullable(t.String()),
  facebook_profile: OptionalNullable(t.String()),
  instagram_profile: OptionalNullable(t.String()),
  linkedin_profile: OptionalNullable(t.String()),
  youtube_profile: OptionalNullable(t.String()),
  blog_url: OptionalNullable(t.String()),
  created_at: OptionalNullable(t.String()),
  updated_at: OptionalNullable(t.String()),
  tiktok_profile: OptionalNullable(t.String()),
  logo_url: OptionalNullable(t.String()),
  logo_background_color: OptionalNullable(t.String()),
  primary_color: OptionalNullable(t.String()),
  secondary_color: OptionalNullable(t.String()),
  accent_color: OptionalNullable(t.String()),
  background_color: OptionalNullable(t.String()),
  text_color: OptionalNullable(t.String()),
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
  target_audience: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
  usps: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
  operating_region: OptionalNullable(t.String()),
});

export const workflowRoutes = new Elysia({ prefix: "/workflow" })
  .post(
    "/",
    async ({ body }) => {
      try {
        const inputs = Array.isArray(body) ? body : [body];
        
        console.log(`Starting workflow for ${inputs.length} company/companies`);
        
        // Process all companies in parallel for better performance
        const resultPromises = inputs.map(async (input) => {
          console.log(`Processing: ${input.company_name}`);
          try {
            const result = await runSEOKeywordWorkflow(input as WorkflowInput);
            return {
              success: true,
              company_name: input.company_name,
              id: input.id,
              data: result,
            };
          } catch (error) {
            console.error(`Error for ${input.company_name}:`, error);
            return {
              success: false,
              company_name: input.company_name,
              id: input.id,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        });
        
        const results = await Promise.all(resultPromises);
        
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
  );
