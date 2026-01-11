// Input Types (aus n8n "When Executed by Another Workflow")
export interface CompanyService {
  name: string;
  category: string;
  description: string;
}

export interface CompanyPurpose {
  services: CompanyService[];
  description: string;
  business_model: {
    type: string;
    description: string;
  };
}

export interface WorkflowInput {
  id: string;
  onboarding_session_id: string;
  company_name: string;
  industry: string;
  industry_subcategory: string;
  custom_subcategory?: string;
  location: string;
  employee_count?: string;
  website: string;
  description: string;
  contact_salutation?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_email?: string;
  contact_phone?: string | null;
  facebook_profile?: string;
  instagram_profile?: string;
  linkedin_profile?: string;
  youtube_profile?: string;
  blog_url?: string;
  created_at?: string;
  updated_at?: string;
  tiktok_profile?: string;
  logo_url?: string;
  logo_background_color?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
  company_purpose: CompanyPurpose;
  target_audience?: string[];
  usps?: string[];
  operating_region?: string;
}

// Location Finder Output
export interface LocationFinderOutput {
  location: string;
  fullLocation: string;
  genre: string;
}

// DataForSEO Types
export interface DataForSEOLocation {
  location_code: number;
  location_name: string;
  location_code_parent?: number | null;
  country_iso_code: string;
  location_type: string;
}

export interface DataForSEOLocationResponse {
  tasks: Array<{
    result: DataForSEOLocation[];
  }>;
}

export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

export interface KeywordData {
  keyword: string;
  search_volume: number;
  monthly_searches?: MonthlySearch[];
  competition?: string;
  competition_index?: number;
  cpc?: number;
  low_top_of_page_bid?: number;
  high_top_of_page_bid?: number;
}

export interface DataForSEOSearchVolumeResponse {
  tasks: Array<{
    result: KeywordData[];
  }>;
}

export interface SERPItem {
  url: string;
  rank_absolute: number;
  domain?: string;
}

export interface DataForSEOSERPResponse {
  tasks: Array<{
    result: Array<{
      items: SERPItem[];
    }>;
  }>;
}

// Workflow Output Types
export interface KeywordResult {
  keyword: string;
  domains: Array<{
    domain: string;
    rank: number;
  }>;
  search_volume: number;
  monthly_searches?: MonthlySearch[];
}

export interface WorkflowOutput {
  keywords: KeywordResult[];
  location: string;
  genre: string;
}

// Crawler Tool Types
export interface CrawlerInput {
  url: string;
  what?: string;
}

export interface CrawlerOutput {
  content: string;
}
