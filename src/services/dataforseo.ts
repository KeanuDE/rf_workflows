import type {
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
 * Findet den Location Code für eine Stadt in Deutschland
 * Entspricht dem "find location" Node im n8n Workflow
 * 
 * n8n URL: https://api.dataforseo.com/v3/keywords_data/google_ads/locations/de?location_name=...
 */
export async function findLocation(fullLocation: string): Promise<DataForSEOLocationResponse> {
  console.log(`[DataForSEO] Finding location for: "${fullLocation}"`);
  
  // Der Endpoint wie im n8n Workflow
  const endpoint = `/keywords_data/google_ads/locations`;
  
  // Versuche mit country_code filter
  const body = [
    {
      country_code: "DE",
      location_name: fullLocation,
    }
  ];
  
  const result = await fetchDataForSEO<DataForSEOLocationResponse>(endpoint, "POST", body, true);
  console.log(`[DataForSEO] Found ${result.tasks?.[0]?.result?.length || 0} locations`);
  return result;
}

/**
 * Holt alle deutschen Locations (für Fallback/Debugging)
 */
export async function getGermanLocations(): Promise<DataForSEOLocationResponse> {
  const endpoint = `/keywords_data/google_ads/locations`;
  const body = [{ country_code: "DE" }];
  return fetchDataForSEO<DataForSEOLocationResponse>(endpoint, "POST", body, true);
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
