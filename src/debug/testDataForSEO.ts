import { getKeywordSearchVolume, findLocation } from "../services/dataforseo";

async function testDataForSEO(): Promise<void> {
  console.log("=".repeat(60));
  console.log("DataForSEO API Debug Test");
  console.log("=".repeat(60));

  const TEST_KEYWORDS = [
    { keyword: "Spedition", name: "National Keyword (sollte Volumen haben)" },
    { keyword: "Spedition Sassenberg", name: "Local Keyword (evtl. 0 Volumen)" },
    { keyword: "Transportunternehmer", name: "Mittel-Level Keyword" }
  ];

  try {
    const locationCode = await findLocation("Sassenberg", "Sassenberg");
    console.log(`\nLocation Code für Sassenberg: ${locationCode}`);
    
    if (!locationCode) {
      console.warn("Kein Location Code gefunden, nutze Deutschland Default (2276)");
    }

    for (const test of TEST_KEYWORDS) {
      console.log(`\n--- Test: ${test.keyword} ---`);
      console.log(`Beschreibung: ${test.name}`);
      
      try {
        const results = await getKeywordSearchVolume([test.keyword], locationCode || 2276);
        
        if (results.length > 0 && results[0]) {
          const result = results[0];
          console.log(`✓ API Response empfangen`);
          console.log(`  Keyword: "${result.keyword}"`);
          console.log(`  Suchvolumen: ${result.search_volume}`);
          console.log(`  Wettbewerb: ${result.competition || 'N/A'}`);
          console.log(`  CPC: ${result.cpc || 'N/A'}`);
          
          if (result.search_volume && result.search_volume > 0) {
            console.log(`✓ Suchvolumen vorhanden`);
          } else {
            console.warn(`  ⚠ Suchvolumen = 0 (erwartbar für Local-Longtails)`);
          }
        } else {
          console.warn(`  ⚠ Keine API Ergebnisse erhalten`);
        }
      } catch (error) {
        console.error(`  ✗ Fehler: ${error}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("DataForSEO API Debug Test abgeschlossen");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Fataler Fehler:", error);
    process.exit(1);
  }
}

testDataForSEO();