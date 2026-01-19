/**
 * Branchen-spezifische Vorlagenbibliothek für Intent-Keyword-Generierung
 * Enthält bevorzugte Suchmuster, positive Beispiele und falsche Assoziationen
 */

export interface IndustryTemplate {
  /** Bevorzugte Suchmuster für diese Branche */
  patterns: string[];
  /** Positive Beispiel-Keywords */
  examples: string[];
  /** Falsche Assoziationen die vermieden werden müssen */
  negatives: string[];
  /** Typische Berufsbezeichnungen */
  professions: string[];
}

/**
 * Branchen-Templates nach industry/industry_subcategory Key
 * Wird im Intent-Prompt als Leitplanken mitgegeben
 */
export const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  // Handwerk
  "maler": {
    patterns: [
      "malerbetrieb [ORT]",
      "maler [ORT]",
      "wohnung streichen lassen [ORT]",
      "fassade streichen [ORT]",
      "malerarbeiten [ORT]",
      "anstreicher [ORT]",
      "tapezieren lassen [ORT]",
    ],
    examples: [
      "malerbetrieb",
      "maler",
      "malerarbeiten",
      "wohnung streichen lassen",
      "fassade streichen",
      "tapezieren",
      "anstreicher",
      "lackierarbeiten innen",
    ],
    negatives: [
      "autolackierer",
      "lackiererei auto",
      "kfz lackierung",
      "fahrzeug lackieren",
      "spraydose",
      "künstler",
      "gemälde",
    ],
    professions: ["maler", "anstreicher", "malerbetrieb", "malerfirma", "malermeister"],
  },

  "lackierer": {
    patterns: [
      "autolackierer [ORT]",
      "kfz lackierung [ORT]",
      "auto lackieren lassen [ORT]",
      "fahrzeuglackierung [ORT]",
      "smart repair [ORT]",
    ],
    examples: [
      "autolackierer",
      "kfz lackierung",
      "auto lackieren lassen",
      "fahrzeuglackierung",
      "smart repair",
      "beulendoktor",
    ],
    negatives: [
      "maler",
      "malerbetrieb",
      "wohnung streichen",
      "fassade",
      "tapezieren",
    ],
    professions: ["autolackierer", "fahrzeuglackierer", "kfz lackierer"],
  },

  "sanitär": {
    patterns: [
      "sanitär [ORT]",
      "klempner [ORT]",
      "sanitärinstallateur [ORT]",
      "bad sanieren [ORT]",
      "badsanierung [ORT]",
      "rohrreinigung [ORT]",
    ],
    examples: [
      "sanitär",
      "klempner",
      "sanitärinstallateur",
      "badsanierung",
      "rohrreinigung",
      "sanitärbetrieb",
      "badezimmer renovieren",
    ],
    negatives: [
      "sanitätshaus",
      "sanitäter",
      "erste hilfe",
      "krankenwagen",
    ],
    professions: ["klempner", "sanitärinstallateur", "sanitärbetrieb", "installateur"],
  },

  "heizung": {
    patterns: [
      "heizungsinstallateur [ORT]",
      "heizungsfirma [ORT]",
      "heizung installieren [ORT]",
      "heizungswartung [ORT]",
      "heizungsmonteur [ORT]",
      "wärmepumpe einbauen [ORT]",
    ],
    examples: [
      "heizungsinstallateur",
      "heizungsfirma",
      "heizungsmonteur",
      "heizungswartung",
      "wärmepumpe installieren",
      "gasheizung",
      "ölheizung",
    ],
    negatives: [
      "heizlüfter kaufen",
      "heizung shop",
      "heizstrahler",
      "kamin deko",
    ],
    professions: ["heizungsinstallateur", "heizungsmonteur", "heizungsbauer", "heizungsfirma"],
  },

  "elektro": {
    patterns: [
      "elektriker [ORT]",
      "elektrofirma [ORT]",
      "elektroinstallation [ORT]",
      "elektriker notdienst [ORT]",
      "elektroarbeiten [ORT]",
    ],
    examples: [
      "elektriker",
      "elektrofirma",
      "elektroinstallation",
      "elektriker notdienst",
      "steckdosen installieren",
      "sicherungskasten",
    ],
    negatives: [
      "elektromarkt",
      "elektrogeräte kaufen",
      "media markt",
      "saturn",
    ],
    professions: ["elektriker", "elektrofirma", "elektroinstallateur", "elektromeister"],
  },

  // Musik & Events
  "band": {
    patterns: [
      "liveband [ORT]",
      "hochzeitsband [ORT]",
      "band buchen [ORT]",
      "partyband [ORT]",
      "coverband [ORT]",
      "band für hochzeit [ORT]",
    ],
    examples: [
      "liveband buchen",
      "hochzeitsband",
      "partyband",
      "coverband",
      "band für firmenfeier",
      "band für geburtstag",
      "tanzband",
    ],
    negatives: [
      "instrumente kaufen",
      "gitarre kaufen",
      "thomann",
      "musicstore",
      "klavier lernen",
      "onlinepianist",
      "musikschule",
      "noten download",
      "spotify",
      "album",
    ],
    professions: ["liveband", "hochzeitsband", "partyband", "coverband", "showband"],
  },

  "dj": {
    patterns: [
      "dj [ORT]",
      "dj buchen [ORT]",
      "hochzeits dj [ORT]",
      "party dj [ORT]",
      "event dj [ORT]",
    ],
    examples: [
      "dj buchen",
      "hochzeits dj",
      "party dj",
      "event dj",
      "dj für firmenfeier",
      "dj für geburtstag",
    ],
    negatives: [
      "dj equipment kaufen",
      "dj controller",
      "dj software",
      "dj lernen",
      "dj kurs",
    ],
    professions: ["dj", "hochzeits-dj", "event-dj", "party-dj"],
  },

  // IT & Dienstleistungen
  "it-dienstleister": {
    patterns: [
      "it dienstleister [ORT]",
      "it betreuung [ORT]",
      "it support firma [ORT]",
      "it service [ORT]",
      "edv service [ORT]",
      "it firma [ORT]",
    ],
    examples: [
      "it dienstleister",
      "it betreuung firma",
      "it support unternehmen",
      "edv service",
      "it systemhaus",
      "managed services",
      "it wartung",
    ],
    negatives: [
      "universität",
      "hochschule",
      "studium informatik",
      "it ausbildung",
      "programmierkurs",
      "online kurs",
      "udemy",
      "coursera",
    ],
    professions: ["it dienstleister", "it systemhaus", "edv betreuer", "it firma"],
  },

  "webdesign": {
    patterns: [
      "webdesign agentur [ORT]",
      "homepage erstellen lassen [ORT]",
      "webseite erstellen [ORT]",
      "webdesigner [ORT]",
      "website agentur [ORT]",
    ],
    examples: [
      "webdesign agentur",
      "homepage erstellen lassen",
      "webseite erstellen",
      "webdesigner",
      "internetagentur",
      "wordpress agentur",
    ],
    negatives: [
      "webdesign lernen",
      "html kurs",
      "homepage baukasten",
      "wix",
      "jimdo",
      "wordpress tutorial",
    ],
    professions: ["webdesigner", "webdesign agentur", "internetagentur", "webagentur"],
  },

  // Beratung & Schulung
  "schulung": {
    patterns: [
      "[THEMA] schulung [ORT]",
      "[THEMA] seminar [ORT]",
      "[THEMA] training [ORT]",
      "[THEMA] workshop [ORT]",
      "firmenschulung [THEMA] [ORT]",
    ],
    examples: [
      "excel schulung",
      "office schulung firma",
      "it schulung unternehmen",
      "mitarbeiterschulung",
      "inhouse training",
      "firmenseminar",
    ],
    negatives: [
      "kostenlos",
      "gratis",
      "youtube tutorial",
      "online kurs kostenlos",
      "uni",
      "hochschule",
      "volkshochschule",
    ],
    professions: ["trainer", "schulungsanbieter", "seminaranbieter", "coach"],
  },

  // Gastronomie & Catering
  "catering": {
    patterns: [
      "catering [ORT]",
      "catering service [ORT]",
      "partyservice [ORT]",
      "buffet bestellen [ORT]",
      "event catering [ORT]",
    ],
    examples: [
      "catering",
      "catering service",
      "partyservice",
      "buffet bestellen",
      "firmencatering",
      "hochzeitscatering",
    ],
    negatives: [
      "rezepte",
      "kochen lernen",
      "kochbuch",
      "lieferando",
      "lieferheld",
    ],
    professions: ["caterer", "catering service", "partyservice"],
  },

  // Fotografie
  "fotograf": {
    patterns: [
      "fotograf [ORT]",
      "hochzeitsfotograf [ORT]",
      "fotostudio [ORT]",
      "business fotograf [ORT]",
      "eventfotograf [ORT]",
    ],
    examples: [
      "fotograf",
      "hochzeitsfotograf",
      "fotostudio",
      "business fotos",
      "bewerbungsfotos",
      "eventfotograf",
      "produktfotografie",
    ],
    negatives: [
      "kamera kaufen",
      "fotokurs",
      "fotografie lernen",
      "lightroom",
      "photoshop tutorial",
      "stockfotos",
    ],
    professions: ["fotograf", "hochzeitsfotograf", "fotostudio", "eventfotograf"],
  },

  // Fahrschule
  "fahrschule": {
    patterns: [
      "fahrschule [ORT]",
      "führerschein [ORT]",
      "führerschein machen [ORT]",
      "fahrschule anmelden [ORT]",
      "autoführerschein [ORT]",
    ],
    examples: [
      "fahrschule",
      "führerschein machen",
      "fahrschule anmelden",
      "fahrschule kosten",
      "intensivkurs führerschein",
      "motorradführerschein",
    ],
    negatives: [
      "führerschein theorie app",
      "führerschein fragen online",
      "theorieprüfung simulator",
    ],
    professions: ["fahrschule", "fahrlehrer"],
  },

  // Reinigung
  "reinigung": {
    patterns: [
      "reinigungsfirma [ORT]",
      "gebäudereinigung [ORT]",
      "büroreinigung [ORT]",
      "reinigungsservice [ORT]",
      "putzfirma [ORT]",
    ],
    examples: [
      "reinigungsfirma",
      "gebäudereinigung",
      "büroreinigung",
      "unterhaltsreinigung",
      "treppenhausreinigung",
      "glasreinigung",
    ],
    negatives: [
      "reinigungsmittel kaufen",
      "staubsauger",
      "putzlappen",
      "dm",
      "rossmann",
    ],
    professions: ["reinigungsfirma", "gebäudereiniger", "reinigungsservice"],
  },

  // Umzug
  "umzug": {
    patterns: [
      "umzugsfirma [ORT]",
      "umzugsunternehmen [ORT]",
      "umzugsservice [ORT]",
      "möbeltransport [ORT]",
      "umzug [ORT]",
    ],
    examples: [
      "umzugsfirma",
      "umzugsunternehmen",
      "umzugsservice",
      "möbeltransport",
      "umzugshelfer",
      "firmenumzug",
    ],
    negatives: [
      "umzugskartons kaufen",
      "möbel",
      "ikea",
      "umzug checkliste",
    ],
    professions: ["umzugsfirma", "umzugsunternehmen", "spediteur"],
  },

  // Garten & Landschaft
  "gartenbau": {
    patterns: [
      "gärtner [ORT]",
      "gartenbau [ORT]",
      "gartengestaltung [ORT]",
      "gartenpflege [ORT]",
      "landschaftsgärtner [ORT]",
    ],
    examples: [
      "gärtner",
      "gartenbau",
      "gartengestaltung",
      "gartenpflege",
      "landschaftsgärtner",
      "rasenpflege",
      "heckenschnitt",
    ],
    negatives: [
      "gartencenter",
      "baumarkt",
      "pflanzen kaufen",
      "obi",
      "hornbach",
      "samen bestellen",
    ],
    professions: ["gärtner", "landschaftsgärtner", "gartenbaubetrieb"],
  },

  // Rechtsanwalt
  "rechtsanwalt": {
    patterns: [
      "rechtsanwalt [ORT]",
      "anwalt [ORT]",
      "anwaltskanzlei [ORT]",
      "rechtsberatung [ORT]",
      "[FACHGEBIET] anwalt [ORT]",
    ],
    examples: [
      "rechtsanwalt",
      "anwalt",
      "anwaltskanzlei",
      "arbeitsrecht anwalt",
      "familienrecht anwalt",
      "mietrecht anwalt",
      "verkehrsrecht anwalt",
    ],
    negatives: [
      "jura studium",
      "rechtsfragen forum",
      "gesetze online",
      "mustervertrag",
    ],
    professions: ["rechtsanwalt", "anwalt", "anwaltskanzlei", "fachanwalt"],
  },

  // Steuerberater
  "steuerberater": {
    patterns: [
      "steuerberater [ORT]",
      "steuerkanzlei [ORT]",
      "steuerberatung [ORT]",
      "buchhaltung [ORT]",
      "lohnbuchhaltung [ORT]",
    ],
    examples: [
      "steuerberater",
      "steuerkanzlei",
      "steuerberatung",
      "buchhaltungsservice",
      "lohnbuchhaltung",
      "finanzbuchhaltung",
    ],
    negatives: [
      "steuererklärung software",
      "elster",
      "wiso steuer",
      "steuer app",
      "steuertipps",
    ],
    professions: ["steuerberater", "steuerkanzlei", "buchhalter"],
  },
};

/**
 * Findet das passende Template für eine Branche
 * Sucht nach exaktem Match, dann nach Teilstring
 */
export function findIndustryTemplate(
  industry: string,
  subcategory?: string
): IndustryTemplate | null {
  const searchTerms = [
    subcategory?.toLowerCase(),
    industry?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const term of searchTerms) {
    // Exakter Match
    if (INDUSTRY_TEMPLATES[term]) {
      return INDUSTRY_TEMPLATES[term];
    }

    // Teilstring Match
    for (const [key, template] of Object.entries(INDUSTRY_TEMPLATES)) {
      if (term.includes(key) || key.includes(term)) {
        return template;
      }
    }
  }

  return null;
}

/**
 * Generiert Template-Hinweise für den Prompt
 */
export function getTemplatePromptSection(template: IndustryTemplate | null): string {
  if (!template) {
    return "";
  }

  return `
BRANCHENSPEZIFISCHE LEITPLANKEN:
Bevorzugte Suchmuster für diese Branche:
${template.patterns.map(p => `- "${p}"`).join("\n")}

Gute Beispiel-Keywords:
${template.examples.map(e => `- "${e}"`).join("\n")}

Typische Berufsbezeichnungen:
${template.professions.map(p => `- "${p}"`).join("\n")}

FALSCHE ASSOZIATIONEN VERMEIDEN (diese Begriffe NICHT verwenden):
${template.negatives.map(n => `- "${n}"`).join("\n")}
`;
}
