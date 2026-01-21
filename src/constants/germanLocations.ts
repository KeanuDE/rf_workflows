/**
 * Deutsche Städte-Konfiguration für Multi-Location SERP-Suche
 *
 * Location Codes von DataForSEO Google Ads Locations API
 * https://api.dataforseo.com/v3/keywords_data/google_ads/locations
 */

// Top 5 deutsche Städte für bundesweite Suche
export const TOP_5_GERMAN_CITIES = [
  { name: "Berlin", locationCode: 1003854, region: "Ost" },
  { name: "Hamburg", locationCode: 1004074, region: "Nord" },
  { name: "München", locationCode: 1004234, region: "Süd" },
  { name: "Köln", locationCode: 1004150, region: "West" },
  { name: "Frankfurt am Main", locationCode: 1004049, region: "Mitte" },
] as const;

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
