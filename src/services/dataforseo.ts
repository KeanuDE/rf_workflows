import type {
  DataForSEOLocation,
  DataForSEOLocationResponse,
  DataForSEOSearchVolumeResponse,
  DataForSEOSERPResponse,
  KeywordData,
} from "../types";

const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }

  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function fetchDataForSEO<T>(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  logResponse: boolean = false
): Promise<T> {
  const url = `${DATAFORSEO_BASE_URL}${endpoint}`;

  console.log(`[DataForSEO] ${method} ${url}`);
  if (body) {
    console.log(`[DataForSEO] Body:`, JSON.stringify(body).substring(0, 500));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  
  if (logResponse) {
    console.log(`[DataForSEO] Response:`, responseText.substring(0, 1000));
  }
  
  if (!response.ok) {
    console.error(`[DataForSEO] Error ${response.status}: ${responseText.substring(0, 500)}`);
    throw new Error(`DataForSEO API error: ${response.status} ${response.statusText}`);
  }

  try {
    const data = JSON.parse(responseText);
    
    // Log status from API response
    if (data.status_code && data.status_code !== 20000) {
      console.warn(`[DataForSEO] API Status: ${data.status_code} - ${data.status_message}`);
    }
    
    // Log task-level errors
    if (data.tasks && data.tasks[0]) {
      const task = data.tasks[0];
      if (task.status_code !== 20000) {
        console.warn(`[DataForSEO] Task Status: ${task.status_code} - ${task.status_message}`);
      }
    }
    
    return data as T;
  } catch (e) {
    console.error(`[DataForSEO] Failed to parse response: ${responseText.substring(0, 500)}`);
    throw e;
  }
}

// Cache für SERP Locations (wird einmal geladen und wiederverwendet)
let serpLocationsCache: DataForSEOLocation[] | null = null;

/**
 * Holt alle verfügbaren SERP Locations von DataForSEO
 * GET https://api.dataforseo.com/v3/serp/google/locations
 */
async function getAllSERPLocations(): Promise<DataForSEOLocation[]> {
  if (serpLocationsCache) {
    console.log(`[DataForSEO] Using cached SERP locations (${serpLocationsCache.length} entries)`);
    return serpLocationsCache;
  }

  console.log(`[DataForSEO] Fetching all SERP locations...`);
  const endpoint = `/serp/google/locations`;
  
  const response = await fetchDataForSEO<{ tasks: Array<{ result: DataForSEOLocation[] }> }>(endpoint, "GET");
  
  const locations = response.tasks?.[0]?.result || [];
  console.log(`[DataForSEO] Loaded ${locations.length} SERP locations`);
  
  // Cache für spätere Verwendung
  serpLocationsCache = locations;
  
  return locations;
}

/**
 * Findet den Location Code für eine Stadt
 * Lädt alle Locations von /serp/google/locations und sucht nach dem passenden location_name
 */
export async function findLocation(locationName: string): Promise<number | null> {
  console.log(`[DataForSEO] Finding location code for: "${locationName}"`);
  
  const allLocations = await getAllSERPLocations();
  
  // Normalisiere den Suchbegriff
  const searchTerm = locationName.toLowerCase().trim();
  
  // Suche nach exaktem Match zuerst
  let match = allLocations.find(
    (loc) => loc.location_name.toLowerCase() === searchTerm
  );
  
  // Falls kein exakter Match, suche nach Teilübereinstimmung
  if (!match) {
    match = allLocations.find(
      (loc) => loc.location_name.toLowerCase().includes(searchTerm)
    );
  }
  
  // Falls immer noch kein Match, suche ob der Suchbegriff im Location Name vorkommt
  if (!match) {
    match = allLocations.find(
      (loc) => searchTerm.includes(loc.location_name.toLowerCase())
    );
  }
  
  if (match) {
    console.log(`[DataForSEO] Found location: "${match.location_name}" (code: ${match.location_code})`);
    return match.location_code;
  }
  
  console.warn(`[DataForSEO] No location found for: "${locationName}"`);
  return null;
}

/**
 * Findet den Location Code für Deutschland
 */
export async function getGermanyLocationCode(): Promise<number> {
  const allLocations = await getAllSERPLocations();
  
  const germany = allLocations.find(
    (loc) => loc.location_name.toLowerCase() === "germany" || 
             loc.location_name.toLowerCase() === "deutschland"
  );
  
  if (germany) {
    console.log(`[DataForSEO] Germany location code: ${germany.location_code}`);
    return germany.location_code;
  }
  
  // Fallback: bekannter Germany Code
  console.warn(`[DataForSEO] Using fallback Germany location code: 2276`);
  return 2276;
}

/**
 * Holt Search Volume für Keywords
 * Entspricht dem "run task" Node im n8n Workflow
 */
export async function getKeywordSearchVolume(
  keywords: string[],
  locationCode: number
): Promise<KeywordData[]> {
  console.log(`[DataForSEO] Getting search volume for ${keywords.length} keywords (location: ${locationCode})`);
  
  const endpoint = "/keywords_data/google_ads/search_volume/live";

  const body = [
    {
      location_code: locationCode,
      language_code: "de",
      keywords: keywords,
    },
  ];

  const response = await fetchDataForSEO<DataForSEOSearchVolumeResponse>(endpoint, "POST", body, true);

  const results = response.tasks?.[0]?.result || [];
  console.log(`[DataForSEO] Received ${results.length} keyword results`);
  
  // Log sample data
  if (results.length > 0) {
    const sample = results[0];
    console.log(`[DataForSEO] Sample: "${sample?.keyword}" - volume: ${sample?.search_volume}`);
  }

  return results;
}

/**
 * Holt SERP Ergebnisse für ein Keyword
 * Entspricht dem "HTTP Request" Node im Loop
 */
export async function getSERPResults(
  keyword: string,
  locationCode: number
): Promise<DataForSEOSERPResponse> {
  console.log(`[DataForSEO] Getting SERP for: "${keyword}"`);
  
  const endpoint = "/serp/google/organic/live/regular";

  const body = [
    {
      language_code: "de",
      location_code: locationCode,
      keyword: keyword,
    },
  ];

  const response = await fetchDataForSEO<DataForSEOSERPResponse>(endpoint, "POST", body);
  
  const itemCount = response.tasks?.[0]?.result?.[0]?.items?.length || 0;
  console.log(`[DataForSEO] SERP returned ${itemCount} items`);
  
  return response;
}

/**
 * Batch-Verarbeitung für Search Volume (max 20 Keywords pro Request)
 */
export async function getKeywordSearchVolumeBatched(
  keywords: string[],
  locationCode: number,
  batchSize: number = 20
): Promise<KeywordData[]> {
  console.log(`[DataForSEO] Batched search volume: ${keywords.length} keywords in batches of ${batchSize}`);
  
  const results: KeywordData[] = [];

  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize);
    console.log(`[DataForSEO] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(keywords.length / batchSize)}`);
    
    try {
      const batchResults = await getKeywordSearchVolume(batch, locationCode);
      results.push(...batchResults);
    } catch (error) {
      console.error(`[DataForSEO] Batch error:`, error);
      // Continue with next batch instead of failing completely
    }

    // Rate limiting: 3 Sekunden Pause zwischen Batches (wie im n8n Wait Node)
    if (i + batchSize < keywords.length) {
      console.log(`[DataForSEO] Waiting 3 seconds before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log(`[DataForSEO] Total results: ${results.length}`);
  return results;
}
