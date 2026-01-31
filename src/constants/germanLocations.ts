/**
 * Deutsche Städte-Konfiguration für Multi-Location SERP-Suche
 *
 * Location Codes von DataForSEO Google Ads Locations API
 * https://api.dataforseo.com/v3/keywords_data/google_ads/locations
 */

// Top 5 deutsche Städte für bundesweite Suche (Nord, Süd, Ost, West, Mitte)
export const TOP_5_GERMAN_CITIES = [
  { name: "Berlin", locationCode: 1003854, region: "Ost" },
  { name: "Hamburg", locationCode: 1004074, region: "Nord" },
  { name: "München", locationCode: 1004234, region: "Süd" },
  { name: "Köln", locationCode: 1004150, region: "West" },
  { name: "Frankfurt am Main", locationCode: 1004049, region: "Mitte" },
] as const;

// ============================================================================
// Bundesländer und ihre Nachbarn für Umkreissuche
// ============================================================================

/**
 * Deutsche Bundesländer mit ihren Nachbar-Bundesländern
 * Für regionale Suche: Städte aus gleichem + Nachbar-Bundesländern
 */
export const STATE_NEIGHBORS: Record<string, string[]> = {
  // Norddeutschland
  "Schleswig-Holstein": ["Hamburg", "Niedersachsen", "Mecklenburg-Vorpommern"],
  Hamburg: ["Schleswig-Holstein", "Niedersachsen"],
  Bremen: ["Niedersachsen"],
  Niedersachsen: [
    "Schleswig-Holstein",
    "Hamburg",
    "Bremen",
    "Mecklenburg-Vorpommern",
    "Brandenburg",
    "Sachsen-Anhalt",
    "Thüringen",
    "Hessen",
    "Nordrhein-Westfalen",
  ],
  "Mecklenburg-Vorpommern": [
    "Schleswig-Holstein",
    "Niedersachsen",
    "Brandenburg",
  ],

  // Ostdeutschland
  Brandenburg: [
    "Mecklenburg-Vorpommern",
    "Niedersachsen",
    "Sachsen-Anhalt",
    "Sachsen",
    "Berlin",
  ],
  Berlin: ["Brandenburg"],
  "Sachsen-Anhalt": [
    "Niedersachsen",
    "Brandenburg",
    "Sachsen",
    "Thüringen",
  ],
  Sachsen: ["Brandenburg", "Sachsen-Anhalt", "Thüringen", "Bayern"],
  Thüringen: [
    "Niedersachsen",
    "Sachsen-Anhalt",
    "Sachsen",
    "Bayern",
    "Hessen",
  ],

  // Westdeutschland
  "Nordrhein-Westfalen": [
    "Niedersachsen",
    "Hessen",
    "Rheinland-Pfalz",
  ],
  Hessen: [
    "Niedersachsen",
    "Thüringen",
    "Bayern",
    "Baden-Württemberg",
    "Rheinland-Pfalz",
    "Nordrhein-Westfalen",
  ],
  "Rheinland-Pfalz": [
    "Nordrhein-Westfalen",
    "Hessen",
    "Baden-Württemberg",
    "Saarland",
  ],
  Saarland: ["Rheinland-Pfalz"],

  // Süddeutschland
  "Baden-Württemberg": ["Hessen", "Bayern", "Rheinland-Pfalz"],
  Bayern: [
    "Baden-Württemberg",
    "Hessen",
    "Thüringen",
    "Sachsen",
  ],
};

/**
 * Mapping von Städten zu Bundesländern
 * Für schnelle Zuordnung ohne API-Call
 */
export const CITY_TO_STATE: Record<string, string> = {
  // Schleswig-Holstein
  Kiel: "Schleswig-Holstein",
  Lübeck: "Schleswig-Holstein",
  Flensburg: "Schleswig-Holstein",
  Neumünster: "Schleswig-Holstein",

  // Hamburg
  Hamburg: "Hamburg",

  // Bremen
  Bremen: "Bremen",
  Bremerhaven: "Bremen",

  // Niedersachsen
  Hannover: "Niedersachsen",
  Braunschweig: "Niedersachsen",
  Osnabrück: "Niedersachsen",
  Oldenburg: "Niedersachsen",
  Göttingen: "Niedersachsen",
  Wolfsburg: "Niedersachsen",
  Salzgitter: "Niedersachsen",
  Hildesheim: "Niedersachsen",
  Wilhelmshaven: "Niedersachsen",
  Celle: "Niedersachsen",
  Lüneburg: "Niedersachsen",

  // Mecklenburg-Vorpommern
  Rostock: "Mecklenburg-Vorpommern",
  Schwerin: "Mecklenburg-Vorpommern",
  Stralsund: "Mecklenburg-Vorpommern",
  Wismar: "Mecklenburg-Vorpommern",
  Greifswald: "Mecklenburg-Vorpommern",

  // Brandenburg
  Potsdam: "Brandenburg",
  Cottbus: "Brandenburg",
  "Frankfurt (Oder)": "Brandenburg",
  "Brandenburg an der Havel": "Brandenburg",

  // Berlin
  Berlin: "Berlin",

  // Sachsen-Anhalt
  Magdeburg: "Sachsen-Anhalt",
  Halle: "Sachsen-Anhalt",
  Dessau: "Sachsen-Anhalt",

  // Sachsen
  Dresden: "Sachsen",
  Leipzig: "Sachsen",
  Chemnitz: "Sachsen",
  Zwickau: "Sachsen",
  Plauen: "Sachsen",
  Meißen: "Sachsen",

  // Thüringen
  Erfurt: "Thüringen",
  Jena: "Thüringen",
  Gera: "Thüringen",
  Weimar: "Thüringen",
  Gotha: "Thüringen",
  Eisenach: "Thüringen",

  // Nordrhein-Westfalen
  Köln: "Nordrhein-Westfalen",
  Düsseldorf: "Nordrhein-Westfalen",
  Dortmund: "Nordrhein-Westfalen",
  Essen: "Nordrhein-Westfalen",
  Duisburg: "Nordrhein-Westfalen",
  Bochum: "Nordrhein-Westfalen",
  Wuppertal: "Nordrhein-Westfalen",
  Bielefeld: "Nordrhein-Westfalen",
  Bonn: "Nordrhein-Westfalen",
  Münster: "Nordrhein-Westfalen",
  Gelsenkirchen: "Nordrhein-Westfalen",
  Mönchengladbach: "Nordrhein-Westfalen",
  Aachen: "Nordrhein-Westfalen",
  Krefeld: "Nordrhein-Westfalen",
  Oberhausen: "Nordrhein-Westfalen",
  Hagen: "Nordrhein-Westfalen",
  Hamm: "Nordrhein-Westfalen",
  Mülheim: "Nordrhein-Westfalen",
  Leverkusen: "Nordrhein-Westfalen",
  Solingen: "Nordrhein-Westfalen",
  Paderborn: "Nordrhein-Westfalen",
  Siegen: "Nordrhein-Westfalen",
  Recklinghausen: "Nordrhein-Westfalen",

  // Hessen
  "Frankfurt am Main": "Hessen",
  Wiesbaden: "Hessen",
  Kassel: "Hessen",
  Darmstadt: "Hessen",
  Offenbach: "Hessen",
  Fulda: "Hessen",
  Marburg: "Hessen",
  Gießen: "Hessen",

  // Rheinland-Pfalz
  Mainz: "Rheinland-Pfalz",
  Ludwigshafen: "Rheinland-Pfalz",
  Koblenz: "Rheinland-Pfalz",
  Trier: "Rheinland-Pfalz",
  Kaiserslautern: "Rheinland-Pfalz",

  // Saarland
  Saarbrücken: "Saarland",

  // Baden-Württemberg
  Stuttgart: "Baden-Württemberg",
  Karlsruhe: "Baden-Württemberg",
  Mannheim: "Baden-Württemberg",
  Freiburg: "Baden-Württemberg",
  Heidelberg: "Baden-Württemberg",
  Ulm: "Baden-Württemberg",
  Heilbronn: "Baden-Württemberg",
  Pforzheim: "Baden-Württemberg",
  Reutlingen: "Baden-Württemberg",
  Esslingen: "Baden-Württemberg",
  Ludwigsburg: "Baden-Württemberg",
  Konstanz: "Baden-Württemberg",
  Tübingen: "Baden-Württemberg",
  "Villingen-Schwenningen": "Baden-Württemberg",
  Offenburg: "Baden-Württemberg",

  // Bayern
  München: "Bayern",
  Nürnberg: "Bayern",
  Augsburg: "Bayern",
  Regensburg: "Bayern",
  Ingolstadt: "Bayern",
  Würzburg: "Bayern",
  Fürth: "Bayern",
  Erlangen: "Bayern",
  Bamberg: "Bayern",
  Bayreuth: "Bayern",
  Passau: "Bayern",
  Rosenheim: "Bayern",
  Landshut: "Bayern",
  Aschaffenburg: "Bayern",
  Kempten: "Bayern",
  Schweinfurt: "Bayern",
};

/**
 * Große Städte pro Bundesland (für Umkreissuche)
 * Sortiert nach Einwohnerzahl
 */
export const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  "Schleswig-Holstein": ["Kiel", "Lübeck", "Flensburg", "Neumünster"],
  Hamburg: ["Hamburg"],
  Bremen: ["Bremen", "Bremerhaven"],
  Niedersachsen: [
    "Hannover",
    "Braunschweig",
    "Osnabrück",
    "Oldenburg",
    "Göttingen",
    "Wolfsburg",
  ],
  "Mecklenburg-Vorpommern": ["Rostock", "Schwerin", "Stralsund", "Greifswald"],
  Brandenburg: ["Potsdam", "Cottbus", "Frankfurt (Oder)"],
  Berlin: ["Berlin"],
  "Sachsen-Anhalt": ["Magdeburg", "Halle", "Dessau"],
  Sachsen: ["Dresden", "Leipzig", "Chemnitz", "Zwickau"],
  Thüringen: ["Erfurt", "Jena", "Gera", "Weimar"],
  "Nordrhein-Westfalen": [
    "Köln",
    "Düsseldorf",
    "Dortmund",
    "Essen",
    "Duisburg",
    "Bochum",
    "Wuppertal",
    "Bielefeld",
    "Bonn",
    "Münster",
  ],
  Hessen: [
    "Frankfurt am Main",
    "Wiesbaden",
    "Kassel",
    "Darmstadt",
    "Offenbach",
  ],
  "Rheinland-Pfalz": [
    "Mainz",
    "Ludwigshafen",
    "Koblenz",
    "Trier",
    "Kaiserslautern",
  ],
  Saarland: ["Saarbrücken"],
  "Baden-Württemberg": [
    "Stuttgart",
    "Karlsruhe",
    "Mannheim",
    "Freiburg",
    "Heidelberg",
    "Ulm",
    "Heilbronn",
  ],
  Bayern: [
    "München",
    "Nürnberg",
    "Augsburg",
    "Regensburg",
    "Ingolstadt",
    "Würzburg",
    "Fürth",
    "Erlangen",
  ],
};

// Germany-weiter Location Code (Fallback)
export const GERMANY_LOCATION_CODE = 2276;

// Nachbarstädte-Mapping für regionale Umkreissuche
// Jede Stadt hat 2-3 relevante Nachbarstädte für erweiterte SERP-Abfrage
export const NEARBY_CITIES: Record<string, string[]> = {
  // Nordrhein-Westfalen
  Münster: ["Osnabrück", "Bielefeld", "Dortmund"],
  Köln: ["Düsseldorf", "Bonn", "Leverkusen"],
  Düsseldorf: ["Köln", "Duisburg", "Essen"],
  Dortmund: ["Bochum", "Essen", "Münster"],
  Essen: ["Dortmund", "Duisburg", "Bochum"],
  Bielefeld: ["Münster", "Osnabrück", "Paderborn"],
  Bonn: ["Köln", "Koblenz", "Siegburg"],

  // Bayern
  München: ["Augsburg", "Rosenheim", "Ingolstadt"],
  Nürnberg: ["Fürth", "Erlangen", "Regensburg"],
  Augsburg: ["München", "Ulm", "Ingolstadt"],
  Regensburg: ["Nürnberg", "Ingolstadt", "Passau"],

  // Baden-Württemberg
  Stuttgart: ["Heilbronn", "Karlsruhe", "Ulm"],
  Karlsruhe: ["Stuttgart", "Mannheim", "Heidelberg"],
  Mannheim: ["Heidelberg", "Karlsruhe", "Darmstadt"],
  Freiburg: ["Basel", "Offenburg", "Villingen-Schwenningen"],

  // Niedersachsen
  Hannover: ["Braunschweig", "Hildesheim", "Celle"],
  Braunschweig: ["Hannover", "Wolfsburg", "Salzgitter"],
  Osnabrück: ["Münster", "Bielefeld", "Oldenburg"],
  Oldenburg: ["Bremen", "Osnabrück", "Wilhelmshaven"],

  // Hessen
  "Frankfurt am Main": ["Wiesbaden", "Darmstadt", "Mainz"],
  Wiesbaden: ["Frankfurt am Main", "Mainz", "Darmstadt"],
  Darmstadt: ["Frankfurt am Main", "Mannheim", "Wiesbaden"],
  Kassel: ["Göttingen", "Fulda", "Marburg"],

  // Sachsen
  Dresden: ["Leipzig", "Chemnitz", "Meißen"],
  Leipzig: ["Dresden", "Halle", "Chemnitz"],
  Chemnitz: ["Dresden", "Leipzig", "Zwickau"],

  // Berlin/Brandenburg
  Berlin: ["Potsdam", "Frankfurt (Oder)", "Cottbus"],
  Potsdam: ["Berlin", "Brandenburg an der Havel", "Magdeburg"],

  // Hamburg/Schleswig-Holstein
  Hamburg: ["Lübeck", "Kiel", "Bremen"],
  Kiel: ["Hamburg", "Lübeck", "Flensburg"],
  Lübeck: ["Hamburg", "Kiel", "Schwerin"],

  // Bremen
  Bremen: ["Hamburg", "Oldenburg", "Hannover"],

  // Rheinland-Pfalz
  Mainz: ["Wiesbaden", "Frankfurt am Main", "Darmstadt"],
  Koblenz: ["Bonn", "Mainz", "Trier"],

  // Saarland
  Saarbrücken: ["Kaiserslautern", "Trier", "Metz"],

  // Thüringen
  Erfurt: ["Weimar", "Jena", "Gotha"],
  Jena: ["Erfurt", "Weimar", "Gera"],

  // Sachsen-Anhalt
  Magdeburg: ["Halle", "Braunschweig", "Potsdam"],
  Halle: ["Leipzig", "Magdeburg", "Erfurt"],

  // Mecklenburg-Vorpommern
  Rostock: ["Schwerin", "Stralsund", "Wismar"],
  Schwerin: ["Rostock", "Lübeck", "Hamburg"],
};

/**
 * Interface für Location mit Code
 */
export interface GermanLocation {
  name: string;
  code: number;
}

/**
 * Prüft ob eine Stadt im Nachbarstädte-Mapping existiert
 */
export function hasNearbyCities(city: string): boolean {
  return city in NEARBY_CITIES;
}

/**
 * Gibt die Nachbarstädte für eine Stadt zurück
 */
export function getNearbyCities(city: string): string[] {
  return NEARBY_CITIES[city] || [];
}

// ============================================================================
// Bundesland-basierte Umkreissuche (NEU)
// ============================================================================

/**
 * Ermittelt das Bundesland für eine Stadt
 * @param city Stadtname
 * @returns Bundesland oder null wenn nicht gefunden
 */
export function getStateForCity(city: string): string | null {
  // Exakter Match
  if (CITY_TO_STATE[city]) {
    return CITY_TO_STATE[city];
  }

  // Case-insensitive Match
  const cityLower = city.toLowerCase();
  for (const [mappedCity, state] of Object.entries(CITY_TO_STATE)) {
    if (mappedCity.toLowerCase() === cityLower) {
      return state;
    }
  }

  // Teilmatch (z.B. "Frankfurt" → "Frankfurt am Main")
  for (const [mappedCity, state] of Object.entries(CITY_TO_STATE)) {
    if (
      mappedCity.toLowerCase().includes(cityLower) ||
      cityLower.includes(mappedCity.toLowerCase())
    ) {
      return state;
    }
  }

  return null;
}

/**
 * Ermittelt Nachbar-Bundesländer für ein Bundesland
 * @param state Bundesland
 * @returns Array von Nachbar-Bundesländern
 */
export function getNeighborStates(state: string): string[] {
  return STATE_NEIGHBORS[state] || [];
}

/**
 * Ermittelt große Städte aus dem gleichen + Nachbar-Bundesländern
 *
 * Strategie:
 * 1. Städte aus dem gleichen Bundesland (max 3)
 * 2. Städte aus Nachbar-Bundesländern (max 2 je Nachbar)
 *
 * @param city Ausgangstadt
 * @param maxCities Maximale Anzahl Städte insgesamt (default: 5)
 * @returns Array von Städtenamen
 */
export function getCitiesInRegion(city: string, maxCities: number = 5): string[] {
  const state = getStateForCity(city);
  if (!state) {
    console.warn(`[GermanLocations] Could not find state for city: ${city}`);
    // Fallback: Nachbarstädte aus NEARBY_CITIES
    const nearby = getNearbyCities(city);
    if (nearby.length > 0) {
      return [city, ...nearby.slice(0, maxCities - 1)];
    }
    return [city];
  }

  const result: string[] = [];

  // 1. Ausgangstadt
  result.push(city);

  // 2. Weitere Städte aus dem gleichen Bundesland
  const samStateCities = MAJOR_CITIES_BY_STATE[state] || [];
  for (const c of samStateCities) {
    if (c !== city && result.length < Math.min(3, maxCities)) {
      result.push(c);
    }
  }

  // 3. Städte aus Nachbar-Bundesländern
  const neighborStates = getNeighborStates(state);
  for (const neighborState of neighborStates) {
    if (result.length >= maxCities) break;

    const neighborCities = MAJOR_CITIES_BY_STATE[neighborState] || [];
    // Nimm nur die größte Stadt pro Nachbar-Bundesland
    if (neighborCities.length > 0 && neighborCities[0]) {
      result.push(neighborCities[0]);
    }
  }

  return result.slice(0, maxCities);
}

/**
 * Ermittelt ob eine Stadt/Region bundesweit oder regional operieren sollte
 * basierend auf Größe der Stadt
 */
export function isLargeCity(city: string): boolean {
  const largeCities = [
    "Berlin",
    "Hamburg",
    "München",
    "Köln",
    "Frankfurt am Main",
    "Stuttgart",
    "Düsseldorf",
    "Leipzig",
    "Dortmund",
    "Essen",
    "Bremen",
    "Dresden",
    "Hannover",
    "Nürnberg",
  ];
  return largeCities.includes(city);
}
