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

/**
 * Findet den Location Code für eine Stadt über Google Ads Locations
 * Entspricht dem "find location" Node im n8n Workflow
 * 
 * n8n URL: https://api.dataforseo.com/v3/keywords_data/google_ads/locations/de?location_name=Minden, North Rhine-Westphalia
 */
export async function findLocation(fullLocation: string, city: string): Promise<number | null> {
  console.log(`[DataForSEO] Finding location for: "${fullLocation}" (city: "${city}")`);
  
  // Der Endpoint EXAKT wie im n8n Workflow:
  // /keywords_data/google_ads/locations/de?location_name=...
  const encodedLocation = encodeURIComponent(fullLocation);
  const endpoint = `/keywords_data/google_ads/locations/de?location_name=${encodedLocation}`;
  
  try {
    const response = await fetchDataForSEO<DataForSEOLocationResponse>(endpoint, "GET", undefined, true);
    const locations = response.tasks?.[0]?.result || [];
    
    console.log(`[DataForSEO] Found ${locations.length} locations`);
    
    // Debug: Zeige alle gefundenen Locations
    if (locations.length > 0) {
      console.log(`[DataForSEO] Available locations:`, locations.slice(0, 5).map(l => `${l.location_name} (${l.location_code})`));
    }
    
    if (locations.length === 0) {
      console.warn(`[DataForSEO] No locations found for: "${fullLocation}"`);
      return null;
    }
    
    const cityLower = city.toLowerCase().trim();
    
    // 1. Versuche exakten Match: location_name beginnt mit "City," (z.B. "Minden,")
    let matchingLocations = locations.filter((loc: DataForSEOLocation) => {
      const locName = loc.location_name.toLowerCase();
      // Location muss mit "city," beginnen (z.B. "minden,north rhine-westphalia,germany")
      return locName.startsWith(cityLower + ",");
    });
    
    console.log(`[DataForSEO] Exact matches for "${city}":`, matchingLocations.length);
    
    // 2. Falls kein exakter Match, suche nach "City" als eigenständiges Wort am Anfang
    if (matchingLocations.length === 0) {
      matchingLocations = locations.filter((loc: DataForSEOLocation) => {
        const locName = loc.location_name.toLowerCase();
        // Muss mit dem Stadtnamen beginnen, gefolgt von Komma oder Leerzeichen
        return locName.startsWith(cityLower) && 
               (locName[cityLower.length] === "," || locName[cityLower.length] === " ");
      });
      console.log(`[DataForSEO] Word-boundary matches for "${city}":`, matchingLocations.length);
    }
    
    if (matchingLocations.length > 0 && matchingLocations[0]) {
      const match = matchingLocations[0];
      console.log(`[DataForSEO] ✓ Using location: "${match.location_name}" (code: ${match.location_code})`);
      return match.location_code;
    }
    
    // 3. Fallback: Nimm den ersten Treffer nur wenn er mit fullLocation übereinstimmt
    if (locations[0]) {
      const firstLoc = locations[0].location_name.toLowerCase();
      const fullLower = fullLocation.toLowerCase();
      
      // Prüfe ob die erste Location wirklich zur Suche passt
      if (firstLoc.includes(cityLower + ",") || firstLoc.startsWith(cityLower)) {
        console.log(`[DataForSEO] Using first result: "${locations[0].location_name}" (code: ${locations[0].location_code})`);
        return locations[0].location_code;
      } else {
        console.warn(`[DataForSEO] First result "${locations[0].location_name}" doesn't match city "${city}" - skipping`);
      }
    }
    
    console.warn(`[DataForSEO] No matching location found for city: "${city}"`);
    return null;
  } catch (error) {
    console.error(`[DataForSEO] Error finding location:`, error);
    return null;
  }
}

/**
 * Findet den Location Code für Deutschland
 */
export async function getGermanyLocationCode(): Promise<number> {
  // Germany location code ist immer 2276
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
  console.log(`[DataForSEO] Keywords sample:`, keywords.slice(0, 3));
  
  const endpoint = "/keywords_data/google_ads/search_volume/live";

  // Body EXAKT wie im n8n Workflow - location_code als String
  const body = [
    {
      location_code: String(locationCode),
      language_code: "de",
      keywords: keywords,
    },
  ];

  console.log(`[DataForSEO] Request body:`, JSON.stringify(body));

  const response = await fetchDataForSEO<DataForSEOSearchVolumeResponse>(endpoint, "POST", body, true);

  const results = response.tasks?.[0]?.result || [];
  console.log(`[DataForSEO] Received ${results.length} keyword results`);
  
  // Log mehr Details
  if (results.length > 0) {
    const withVolume = results.filter(r => r.search_volume && r.search_volume > 0);
    console.log(`[DataForSEO] Keywords with volume > 0: ${withVolume.length}/${results.length}`);
    
    // Zeige die ersten paar Ergebnisse
    results.slice(0, 5).forEach(r => {
      console.log(`[DataForSEO]   - "${r.keyword}": volume=${r.search_volume}`);
    });
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
