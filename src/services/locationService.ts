/**
 * Location Service
 *
 * Erweiterte Standort-Logik für Umkreissuche basierend auf Bundesländern.
 * Verwendet DataForSEO Locations API für Location Codes.
 *
 * Strategien:
 * - Regional: Hauptort + Städte aus gleichem/Nachbar-Bundesland
 * - Bundesweit: Top 5 Städte (Nord, Süd, Ost, West, Mitte)
 */

import { findLocation } from "./dataforseo";
import {
  TOP_5_GERMAN_CITIES,
  GERMANY_LOCATION_CODE,
  getNearbyCities,
  getStateForCity,
  getCitiesInRegion,
  type GermanLocation,
} from "../constants/germanLocations";

// ============================================================================
// Location Code Resolution
// ============================================================================

/**
 * Cache für Location Codes um API-Calls zu reduzieren
 */
const locationCodeCache = new Map<string, number>();

/**
 * Ermittelt den Location Code für eine Stadt
 * Mit Caching für Performance
 *
 * @param city Stadtname
 * @param fullLocation Vollständige Location (Stadt, Bundesland) - optional
 */
async function getLocationCodeForCity(
  city: string,
  fullLocation?: string
): Promise<number | null> {
  // Cache-Check
  const cacheKey = city.toLowerCase();
  if (locationCodeCache.has(cacheKey)) {
    const cached = locationCodeCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`[LocationService] Cache hit for ${city}: ${cached}`);
      return cached;
    }
  }

  // API-Call
  const searchLocation = fullLocation || city;
  const code = await findLocation(searchLocation, city);

  if (code) {
    locationCodeCache.set(cacheKey, code);
    console.log(`[LocationService] Found code for ${city}: ${code}`);
  } else {
    console.warn(`[LocationService] Could not find location code for ${city}`);
  }

  return code;
}

// ============================================================================
// Multi-Location Strategy
// ============================================================================

/**
 * Ermittelt Location Codes für regionale Suche
 *
 * NEU: Verwendet Bundesland-basierte Umkreislogik:
 * 1. Hauptstadt
 * 2. Weitere Städte aus gleichem Bundesland
 * 3. Größte Städte aus Nachbar-Bundesländern
 *
 * @param city Hauptstadt des Kunden
 * @param fullLocation Vollständige Location (Stadt, Bundesland)
 * @param maxLocations Maximale Anzahl Locations (default: 5)
 */
export async function getRegionalLocations(
  city: string,
  fullLocation: string,
  maxLocations: number = 5
): Promise<GermanLocation[]> {
  console.log(
    `[LocationService] Getting regional locations for: ${city} (max: ${maxLocations})`
  );

  const locations: GermanLocation[] = [];
  const processedCities = new Set<string>();

  // 1. Hauptstadt
  const mainCode = await getLocationCodeForCity(city, fullLocation);
  if (mainCode) {
    locations.push({ name: city, code: mainCode });
    processedCities.add(city.toLowerCase());
    console.log(`[LocationService] Main location: ${city} (${mainCode})`);
  } else {
    console.warn(
      `[LocationService] Could not find code for main city ${city}, using Germany default`
    );
    locations.push({ name: "Germany", code: GERMANY_LOCATION_CODE });
    return locations;
  }

  // 2. Bundesland-basierte Umkreisstädte (NEU)
  const regionCities = getCitiesInRegion(city, maxLocations);
  console.log(
    `[LocationService] Region cities for ${city}: ${regionCities.join(", ")}`
  );

  for (const regionCity of regionCities) {
    if (locations.length >= maxLocations) break;
    if (processedCities.has(regionCity.toLowerCase())) continue;

    try {
      const code = await getLocationCodeForCity(regionCity);
      if (code) {
        locations.push({ name: regionCity, code });
        processedCities.add(regionCity.toLowerCase());
        console.log(
          `[LocationService] Added region city: ${regionCity} (${code})`
        );
      }

      // Rate Limiting
      await sleep(500);
    } catch (error) {
      console.warn(
        `[LocationService] Error getting code for ${regionCity}:`,
        error
      );
    }
  }

  // 3. Fallback: Alte NEARBY_CITIES falls noch Platz
  if (locations.length < maxLocations) {
    const nearbyCities = getNearbyCities(city);
    for (const nearbyCity of nearbyCities) {
      if (locations.length >= maxLocations) break;
      if (processedCities.has(nearbyCity.toLowerCase())) continue;

      try {
        const code = await getLocationCodeForCity(nearbyCity);
        if (code) {
          locations.push({ name: nearbyCity, code });
          processedCities.add(nearbyCity.toLowerCase());
          console.log(
            `[LocationService] Added nearby city: ${nearbyCity} (${code})`
          );
        }
        await sleep(500);
      } catch (error) {
        console.warn(`[LocationService] Error for ${nearbyCity}:`, error);
      }
    }
  }

  console.log(
    `[LocationService] Final regional locations (${locations.length}): ${locations.map((l) => l.name).join(", ")}`
  );
  return locations;
}

/**
 * Ermittelt Location Codes für bundesweite Suche
 *
 * Verwendet Top 5 deutsche Städte (Nord, Süd, Ost, West, Mitte)
 * für maximale geografische Abdeckung.
 */
export function getNationwideLocations(): GermanLocation[] {
  const locations = TOP_5_GERMAN_CITIES.map((c) => ({
    name: c.name,
    code: c.locationCode,
  }));

  console.log(
    `[LocationService] Nationwide locations: ${locations.map((l) => l.name).join(", ")}`
  );
  return locations;
}

/**
 * Hauptfunktion: Ermittelt Location Codes basierend auf Operating Region
 *
 * @param operatingRegion "regional" oder "nationwide"
 * @param city Hauptstadt des Kunden
 * @param fullLocation Vollständige Location (Stadt, Bundesland)
 * @param maxLocations Maximale Anzahl Locations für regionale Suche
 */
export async function getLocationsForSearch(
  operatingRegion: string,
  city: string,
  fullLocation: string,
  maxLocations: number = 5
): Promise<GermanLocation[]> {
  console.log(
    `[LocationService] Getting locations for ${operatingRegion} search (city: ${city})`
  );

  if (operatingRegion === "nationwide") {
    return getNationwideLocations();
  }

  // Regional: Bundesland-basierte Umkreissuche
  return getRegionalLocations(city, fullLocation, maxLocations);
}

// ============================================================================
// State Detection from Location String
// ============================================================================

/**
 * Extrahiert Bundesland aus fullLocation String
 *
 * Formate:
 * - "München, Bayern"
 * - "München, Bayern, Germany"
 * - "München, BY, Deutschland"
 *
 * @param fullLocation Vollständige Location
 */
export function extractStateFromLocation(fullLocation: string): string | null {
  // Mapping von Abkürzungen zu vollen Namen
  const stateAbbreviations: Record<string, string> = {
    BW: "Baden-Württemberg",
    BY: "Bayern",
    BE: "Berlin",
    BB: "Brandenburg",
    HB: "Bremen",
    HH: "Hamburg",
    HE: "Hessen",
    MV: "Mecklenburg-Vorpommern",
    NI: "Niedersachsen",
    NW: "Nordrhein-Westfalen",
    RP: "Rheinland-Pfalz",
    SL: "Saarland",
    SN: "Sachsen",
    ST: "Sachsen-Anhalt",
    SH: "Schleswig-Holstein",
    TH: "Thüringen",
  };

  // Liste aller Bundesländer
  const allStates = [
    "Baden-Württemberg",
    "Bayern",
    "Berlin",
    "Brandenburg",
    "Bremen",
    "Hamburg",
    "Hessen",
    "Mecklenburg-Vorpommern",
    "Niedersachsen",
    "Nordrhein-Westfalen",
    "Rheinland-Pfalz",
    "Saarland",
    "Sachsen",
    "Sachsen-Anhalt",
    "Schleswig-Holstein",
    "Thüringen",
    // English names
    "Bavaria",
    "North Rhine-Westphalia",
    "Lower Saxony",
    "Rhineland-Palatinate",
    "Saxony",
    "Saxony-Anhalt",
  ];

  // English to German mapping
  const englishToGerman: Record<string, string> = {
    Bavaria: "Bayern",
    "North Rhine-Westphalia": "Nordrhein-Westfalen",
    "Lower Saxony": "Niedersachsen",
    "Rhineland-Palatinate": "Rheinland-Pfalz",
    Saxony: "Sachsen",
    "Saxony-Anhalt": "Sachsen-Anhalt",
  };

  const parts = fullLocation.split(",").map((p) => p.trim());

  for (const part of parts) {
    // Prüfe Abkürzungen
    const abbrevMatch = stateAbbreviations[part.toUpperCase()];
    if (abbrevMatch) {
      return abbrevMatch;
    }

    // Prüfe volle Namen
    for (const state of allStates) {
      if (part.toLowerCase() === state.toLowerCase()) {
        // Konvertiere englische Namen
        return englishToGerman[state] || state;
      }
    }
  }

  return null;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Löscht den Location Code Cache (für Tests)
 */
export function clearLocationCache(): void {
  locationCodeCache.clear();
  console.log("[LocationService] Cache cleared");
}
