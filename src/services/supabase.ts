import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface RedaktionsplanInput {
  customer_id: string;
  package: "starter" | "professional" | "enterprise";
  action: string;
  feedback?: string;
}

export interface CompanyProfile {
  id: string;
  company_name: string;
  industry: string;
  target_audience?: string[] | null;
  services?: string | null;
}

export interface CompetitiveAnalysis {
  id: string;
  customer_id: string;
  data?: Record<string, unknown> | null;
}

export interface RedaktionsplanRow {
  id?: string;
  customer_id: string;
  titel: string;
  publish_plan: unknown;
  created_at?: string;
}

export async function getCompanyProfile(customerId: string): Promise<CompanyProfile | null> {
  if (!supabase) {
    console.warn("[Supabase] Client not available");
    return null;
  }

  console.log(`[Supabase] Loading company profile: ${customerId}`);
  
  const { data, error } = await supabase
    .from("company_profiles")
    .select("id, company_name, industry, target_audience, services")
    .eq("id", customerId)
    .single();

  if (error) {
    console.error(`[Supabase] Error loading company:`, error.message);
    return null;
  }

  return data as CompanyProfile;
}

export async function getCompetitiveAnalysis(customerId: string): Promise<CompetitiveAnalysis[]> {
  if (!supabase) {
    console.warn("[Supabase] Client not available");
    return [];
  }

  console.log(`[Supabase] Loading competitive analysis for: ${customerId}`);
  
  const { data, error } = await supabase
    .from("competitive_analysis")
    .select("id, customer_id, data")
    .eq("customer_id", customerId);

  if (error) {
    console.error(`[Supabase] Error loading competitive analysis:`, error.message);
    return [];
  }

  return data as CompetitiveAnalysis[];
}

export async function getExistingRedaktionsplan(customerId: string): Promise<RedaktionsplanRow | null> {
  if (!supabase) {
    console.warn("[Supabase] Client not available");
    return null;
  }

  console.log(`[Supabase] Checking existing redaktionsplan for: ${customerId}`);
  
  const { data, error } = await supabase
    .from("redaktionsplan")
    .select("id, customer_id, titel, publish_plan, created_at")
    .eq("customer_id", customerId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(`[Supabase] Error checking redaktionsplan:`, error.message);
  }

  return data as RedaktionsplanRow | null;
}

export async function deleteRedaktionsplan(customerId: string): Promise<void> {
  if (!supabase) {
    console.warn("[Supabase] Client not available");
    return;
  }

  console.log(`[Supabase] Deleting existing redaktionsplan for: ${customerId}`);
  
  const { error } = await supabase
    .from("redaktionsplan")
    .delete()
    .eq("customer_id", customerId);

  if (error) {
    console.error(`[Supabase] Error deleting redaktionsplan:`, error.message);
  }
}

export async function createRedaktionsplan(
  customerId: string,
  title: string,
  publishPlan: unknown
): Promise<string | null> {
  if (!supabase) {
    console.warn("[Supabase] Client not available");
    return null;
  }

  console.log(`[Supabase] Creating redaktionsplan for: ${customerId}`);
  
  const { data, error } = await supabase
    .from("redaktionsplan")
    .insert({
      customer_id: customerId,
      titel: title,
      publish_plan: publishPlan,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[Supabase] Error creating redaktionsplan:`, error.message);
    return null;
  }

  return data?.id || null;
}

export { supabase };
