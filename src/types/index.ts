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
  entityType?: EntityType; // NEU: Dienstleister/Händler/Hybrid
}

// Entity Classification Types (NEU)
export type EntityType = "dienstleister" | "haendler" | "hybrid" | "unknown";

export interface EntityClassification {
  isCompany: boolean;
  entityType: EntityType;
  detectedGenre: string;
  isRelevantCompetitor: boolean;
  confidence: number;
  reason: string;
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

// DataForSEO Labs API Types (NEU)
export interface SERPCompetitorMetrics {
  organic: {
    etv: number; // Estimated Traffic Volume
    count: number; // Ranked Keywords Count
    is_new: number;
    is_up: number;
    is_down: number;
    is_lost: number;
  };
  paid?: {
    etv: number;
    count: number;
  };
}

export interface SERPCompetitorItem {
  domain: string;
  avg_position: number;
  sum_position: number;
  intersections: number;
  full_domain_metrics: SERPCompetitorMetrics;
  competitor_metrics: {
    organic: {
      etv: number;
      count: number;
      avg_position: number;
    };
  };
}

export interface DataForSEOLabsSERPCompetitorsResponse {
  tasks: Array<{
    status_code: number;
    status_message: string;
    result: Array<{
      se_type: string;
      location_code: number;
      language_code: string;
      total_count: number;
      items: SERPCompetitorItem[];
    }>;
  }>;
}

export interface CompetitorDomainItem {
  domain: string;
  avg_position: number;
  sum_position: number;
  intersections: number;
  full_domain_metrics: SERPCompetitorMetrics;
}

export interface DataForSEOLabsCompetitorsDomainResponse {
  tasks: Array<{
    status_code: number;
    status_message: string;
    result: Array<{
      se_type: string;
      location_code: number;
      language_code: string;
      total_count: number;
      items: CompetitorDomainItem[];
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
  competitors?: CompetitorProfile[]; // NEU: Validierte Wettbewerber
}

// Social Media Types (NEU)
export interface SocialLinks {
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  twitter: string | null;
  youtube: string | null;
  tiktok: string | null;
}

export interface InstagramProfile {
  username: string;
  fullName: string;
  followersCount: number;
  followsCount: number;
  postsCount: number;
  biography: string;
  externalUrl: string | null;
  verified: boolean;
  profilePicUrl: string;
}

export interface FacebookPage {
  title: string;
  likes: number;
  followers: number;
  email: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  ratingCount: number | null;
  adStatus: string;
  categories: string[];
}

// Competitor Profile (NEU) - Kombinierte SEO + Social Daten
export interface CompetitorProfile {
  // SEO-Daten (von DataForSEO Labs)
  domain: string;
  seoTraffic: number; // Estimated Traffic Volume
  rankedKeywords: number; // Anzahl rankender Keywords
  avgPosition: number; // Durchschnittliche SERP-Position

  // Entity-Klassifikation (von OpenAI)
  entityType: EntityType;
  detectedGenre: string;
  isRelevantCompetitor: boolean;

  // Social Media Daten (von Apify)
  socialLinks: SocialLinks;
  instagramFollowers: number | null;
  facebookLikes: number | null;
  facebookFollowers: number | null;

  // Kombinierter Score (50% SEO + 50% Social)
  seoScore: number; // 0-100 basierend auf Traffic/Keywords
  socialScore: number; // 0-100 basierend auf Social Engagement
  overallScore: number; // Gewichteter Gesamtscore
}

// Crawler Tool Types
export interface CrawlerInput {
  url: string;
  what?: string;
}

export interface CrawlerOutput {
  content: string;
}

// Scraper Types (für /scrape Endpunkt)
export interface ScraperInput {
  company: string; // URL der Website
}

export interface ScraperOutput {
  body: string; // document.body.outerHTML
  footer: string; // footer.outerHTML (leer wenn nicht vorhanden)
  links: string[]; // Deduplizierte Links aus Body + Footer
  css: string; // Inline CSS Rules (accessible stylesheets)
  cssLinks: string[]; // Externe Stylesheet URLs
  hadRedirect: boolean; // Redirect stattgefunden?
  startUrl: string; // Original URL
  finalUrl: string; // Finale URL nach Redirects
}
