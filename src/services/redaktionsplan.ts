import OpenAI from "openai";
import { 
  getCompanyProfile, 
  getCompetitiveAnalysis, 
  getExistingRedaktionsplan,
  deleteRedaktionsplan,
  createRedaktionsplan,
  type RedaktionsplanInput,
  type CompanyProfile,
  type CompetitiveAnalysis
} from "./supabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_GPT_5_1 = "gpt-5.1";
const MODEL_GPT_4_1_MINI = "gpt-4.1-mini";

export interface ContentPiece {
  datum: string;
  format: "Post" | "Artikel" | "Reel" | "Story" | "Erklaervideo";
  titel: string;
  plattformen: string[];
  ziel: string;
  hook: string;
  template_type: string;
  prompt: {
    prompt_text_ki: string;
    prompt_bild_ki: string;
    prompt_video_ki: string;
  };
  hashtags?: string[];
  posting_time?: string;
  expected_engagement_rate?: string;
  target_segments?: string[];
  success_metrics?: {
    target_likes?: number;
    target_comments?: number;
    target_shares?: number;
    target_views?: number;
    target_backlinks?: number;
  };
  seo_keywords?: string[];
  expected_traffic?: string;
}

export interface RedaktionsplanResult {
  customer_id: string;
  company_name: string;
  package: string;
  title: string;
  content_pieces: ContentPiece[];
  created_at: string;
}

function getPlanDetails(pkg: string): string {
  switch (pkg) {
    case "starter":
      return `12 Social Media Posts
Frei wählbar: FB, IG, LinkedIn
1 Blog-Artikel
(SEO)
1.000 Wörter, Google-optimiert`;
    case "professional":
      return `20 Social Media Posts
Professioneller Content-Mix
12 Stories
+ 2 Reels
Video-Content für mehr Reichweite
3 Artikel (SEO + GEO)
1 Fachartikel
+ 2 Blog-Artikel`;
    case "enterprise":
      return `32 Social Media Posts
Maximale Präsenz auf allen Kanälen
30 Stories
+ 4 Reels
Tägliche Video-Präsenz
6 Artikel
2 Fachartikel
+ 4 Blog-Artikel
1 Erklärvideo
YouTube-optimiert (45-60 Sek.)`;
    default:
      return `12 Social Media Posts
Frei wählbar: FB, IG, LinkedIn
1 Blog-Artikel
(SEO)
1.000 Wörter, Google-optimiert`;
  }
}

function getContentCount(pkg: string): { posts: number; stories: number; reels: number; articles: number; videos: number } {
  switch (pkg) {
    case "starter":
      return { posts: 12, stories: 0, reels: 0, articles: 1, videos: 0 };
    case "professional":
      return { posts: 20, stories: 12, reels: 2, articles: 3, videos: 0 };
    case "enterprise":
      return { posts: 32, stories: 30, reels: 4, articles: 6, videos: 1 };
    default:
      return { posts: 12, stories: 0, reels: 0, articles: 1, videos: 0 };
  }
}

async function generateRedaktionsplanPart1(
  company: CompanyProfile,
  competitiveData: CompetitiveAnalysis[],
  planDetails: string,
  feedback?: string
): Promise<string> {
  const systemPrompt = `Du bist ein strategischer Content- und Social-Media-Planer mit 15+ Jahren Erfahrung in digitaler Strategie.

AUFGABE: Erstelle einen HOCHPERFORMANTEN Redaktionsplan für ${new Date().toLocaleString("de-DE", { month: "long", year: "numeric" })}`;

  const userPrompt = `EINGABEDATEN:
- Markenname: ${company.company_name}
- Branche: ${company.industry}
- Zielgruppe: ${company.target_audience?.join(", ") || "Nicht definiert"}
- Dienstleistungen: ${company.services || "Nicht definiert"}
- Wettbewerbsanalyse: ${JSON.stringify(competitiveData.map(c => c.data))}
- Paket: ${planDetails}
- Nutzer-Feedback: ${feedback || "Kein Feedback"}

SCHRITT 1: ZIELE DEFINIEREN
Basierend auf der Wettbewerbsanalyse, definiere die TOP 3 ZIELE für diesen Monat:
1. Primäres Ziel: z.B. "Neukundengewinnung", "Engagement-Steigerung", "Traffic-Generierung"
2. Sekundäres Ziel: z.B. "Aufbau Expertenstatus", "Community-Aufbau"
3. Tertiäres Ziel: z.B. "Markenbekanntheit", "Lead-Generierung"

SCHRITT 2: CONTENT-MIX DEFINIEREN
Basierend auf dem Paket, definiere die EXAKTE Content-Verteilung.

SCHRITT 3: WETTBEWERBS-DIFFERENZIERUNG
Analysiere die Wettbewerbsanalyse und identifiziere:
1. Wo sind WIR besser als die Konkurrenz?
2. Welche Content-Lücken gibt es bei der Konkurrenz?
3. Welche Themen werden von der Konkurrenz NICHT abgedeckt?

SCHRITT 4: THEMEN-POOL ERSTELLEN
Basierend auf den Dienstleistungen und Zielgruppen, erstelle einen Pool von 20-30 möglichen Themen:
- Tipps & Tricks (5-7 Themen)
- Produkt-Fokus (3-5 Themen)
- Fallstudien/Erfolgsgeschichten (2-3 Themen)
- Branchentrends (2-3 Themen)
- FAQ/Problem-Lösungen (3-5 Themen)
- Behind-the-Scenes (2-3 Themen)
- Thought Leadership (2-3 Themen)

Gib die Ergebnisse als strukturiertes JSON zurück.`;

  console.log("[Redaktionsplan] Part 1: Generiere strategischen Plan...");
  
  const response = await openai.chat.completions.create({
    model: MODEL_GPT_5_1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return response.choices[0]?.message?.content || "";
}

async function generateRedaktionsplanPart2(
  previousOutput: string,
  planDetails: string,
  company: CompanyProfile,
  competitiveData: CompetitiveAnalysis[]
): Promise<string> {
  const systemPrompt = `Es sollen:
${planDetails}
generiert werden.

SCHRITT 5: CONTENT-PIECES GENERIEREN

Für JEDEN Content-Piece, folge dieser Struktur:

TEMPLATE: WOCHENTIPP (für Tipps/Bildungs-Posts)
- Hook (1 Satz): Aufmerksamkeit erregen
- 2 praktische Tipps (2-3 Sätze): Konkrete, umsetzbare Tipps
- CTA (1 Satz): Call-to-Action
- 3-5 Hashtags: Relevante Hashtags
- Zeichenlimit: Max. 140 Zeichen (ohne Hashtags)

TEMPLATE: PRODUKTFOKUS (für Produkt-Posts)
- Hook (1 Satz): Nutzen hervorheben
- Feature/Nutzen (2-3 Sätze): Was macht das Produkt besonders?
- Social Proof (1 Satz): Kurzes Zitat oder Beweis
- CTA (1 Satz): Konkrete Aufforderung (z.B. "Jetzt testen")
- 3-5 Hashtags
- Zeichenlimit: Max. 150 Zeichen

TEMPLATE: COMMUNITY/BEHIND-THE-SCENES
- Hook-Frage (1 Satz): Engagement-Frage
- Beispiel/Beschreibung (2 Sätze): Kurze Illustration
- CTA (1 Satz): Kommentar-Aufforderung
- 3-5 Hashtags

TEMPLATE: ARTIKEL (Blog)
- Einleitung (120-150 Wörter): Hook + Problem-Definition
- Hauptabschnitt 1 (200-250 Wörter): Erste Lösung/Tipp
- Hauptabschnitt 2 (200-250 Wörter): Zweite Lösung/Tipp
- Hauptabschnitt 3 (200-250 Wörter): Dritte Lösung/Tipp (optional)
- Fazit (80-120 Wörter): Zusammenfassung + CTA
- SEO-Keywords: 2-3 Fokus-Keywords

SCHRITT 6: KI-PROMPTS ERSTELLEN

Für JEDEN Content-Piece, erstelle 3 detaillierte KI-Prompts:

PROMPT 1: TEXT-KI
- Struktur: Welche Abschnitte?
- Tonalität: Formal, humorvoll, inspirierend?
- Länge: Zeichenlimit oder Wortanzahl?
- Keywords: Welche Keywords sollten enthalten sein?
- CTA: Welche konkrete Aufforderung?

PROMPT 2: BILD-KI
- Stil: Minimalistisch, illustriert, fotografisch?
- Farben: HEX-Werte (z.B. #FF6B6B)
- Elemente: Welche Icons/Symbole?
- Hintergrund: Farbe oder Muster?
- Größe: Dimensionen (z.B. 1080x1080px)
- WICHTIG: Keine realen Personen, Fotos oder Locations

PROMPT 3: VIDEO-KI (nur für Reels/Videos)
- Szenen: Welche Szenen?
- Dauer: 15-30 Sekunden?
- Text-Overlays: Welche Texte?
- Musik: Welcher Stil?
- CTA: Welche Aufforderung am Ende?`;

  const userPrompt = `Unternehmen: ${company.company_name}
Branche: ${company.industry}
Wettbewerbsanalyse: ${JSON.stringify(competitiveData.map(c => c.data))}

Vorherige Planung: ${previousOutput}

Erstelle detaillierte Content-Pieces mit KI-Prompts.`;

  console.log("[Redaktionsplan] Part 2: Generiere Content-Pieces mit Prompts...");
  
  const response = await openai.chat.completions.create({
    model: MODEL_GPT_5_1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return response.choices[0]?.message?.content || "";
}

async function generateRedaktionsplanPart3(
  previousOutput: string,
  pkg: string
): Promise<ContentPiece[]> {
  const counts = getContentCount(pkg);
  
  const systemPrompt = `Gib GENAU dieses JSON-Format aus (keine zusätzlichen Erklärungen):
[
  {
    "datum": "YYYY-MM-DD",
    "format": "Post",
    "titel": "Wochentipp: So startest du perfekt",
    "plattformen": ["instagram", "facebook"],
    "ziel": "Neukundengewinnung, Engagement-Steigerung",
    "hook": "So startest du perfekt in die Woche",
    "template_type": "Wochentipp",
    "prompt": {
      "prompt_text_ki": "Erstelle einen Social-Media-Post im Wochentipp-Format. Hook: 'So startest du perfekt in die Woche'. Tipps: 2 praktische Tipps zum Thema [THEMA]. Tonalität: freundlich, kompetent. Max. 140 Zeichen (ohne Hashtags). CTA: 'Probier es aus!'",
      "prompt_bild_ki": "Generiere ein minimalistisches Icon einer Zielscheibe mit 3 konzentrischen Kreisen. Farben: Primär #FF6B6B (Rot), Sekundär #FFFFFF (Weiß). Flacher Stil, kein Hintergrund, 1080x1080px.",
      "prompt_video_ki": ""
    },
    "hashtags": ["#marke", "#tipp", "#inspiration"],
    "posting_time": "09:00",
    "expected_engagement_rate": "3.5%",
    "target_segments": ["Anfänger", "Entscheider"],
    "success_metrics": {
      "target_likes": 50,
      "target_comments": 10,
      "target_shares": 5
    }
  },
  {
    "datum": "2026-01-15",
    "format": "Artikel",
    "titel": "Warum [THEMA] heute wichtiger ist als je zuvor",
    "plattformen": ["blog"],
    "ziel": "SEO-Traffic, Aufbau Expertenstatus",
    "hook": "Warum [THEMA] heute wichtiger ist als je zuvor",
    "template_type": "Artikel-Template",
    "prompt": {
      "prompt_text_ki": "Schreibe einen ca. 1.000 Wörter langen SEO-Blogartikel zum Thema [THEMA]. Struktur: Einleitung (120-150 Wörter), 3 Hauptabschnitte (je 200-250 Wörter mit Beispielen), Fazit (80-120 Wörter). Keywords: [KEYWORD1], [KEYWORD2], [KEYWORD3]. Tonalität: fachlich, verständlich, freundlich.",
      "prompt_bild_ki": "Generiere ein abstraktes Headerbild mit Symbolen/Icons zum Thema [THEMA]. Reduzierte Farbpalette in Markenfarben (#FF6B6B, #4ECDC4). Keine Personen, keine Fotorealistik. 1200x630px.",
      "prompt_video_ki": ""
    },
    "seo_keywords": ["keyword1", "keyword2", "keyword3"],
    "expected_traffic": "150-200 Besucher pro Monat",
    "success_metrics": {
      "target_views": 500,
      "target_shares": 20,
      "target_backlinks": 3
    }
  }
]

WICHTIG:
- Die Anzahl der Posts entspricht GENAU der Paketdefinition (${counts.posts} Posts, ${counts.stories} Stories, ${counts.reels} Reels, ${counts.articles} Artikel, ${counts.videos} Videos)
- KEINE weiteren Erklärtexte oder Kommentare außerhalb des JSON-Arrays
- Jeder Content-Piece ist AUTOMATISIERBAR
- Alle Prompts sind PRÄZISE und DETAILLIERT
- datum muss im Format YYYY-MM-DD sein
- Ver分布在 den Monat gleichmäßig`;

  console.log("[Redaktionsplan] Part 3: Generiere strukturiertes JSON mit Content-Pieces...");
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    try {
      const response = await openai.chat.completions.create({
        model: MODEL_GPT_4_1_MINI,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Erstelle den Redaktionsplan für ${pkg}-Paket basierend auf: ${previousOutput}` },
        ],
      });

      const content = response.choices[0]?.message?.content || "";
      
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed as ContentPiece[];
        }
      }
      
      console.warn(`[Redaktionsplan] Part 3: Attempt ${attempts} - Could not parse JSON, retrying...`);
    } catch (error) {
      console.error(`[Redaktionsplan] Part 3: Attempt ${attempts} error:`, error);
    }
    
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.error("[Redaktionsplan] Part 3: Failed after all attempts, returning empty array");
  return [];
}

function createContentPiece(
  source: Record<string, unknown>,
  defaults: Partial<ContentPiece>
): ContentPiece {
  return {
    datum: String(source.datum || defaults.datum || ""),
    format: (source.format as ContentPiece["format"]) || defaults.format || "Post",
    titel: String(source.titel || defaults.titel || ""),
    plattformen: Array.isArray(source.plattformen) ? source.plattformen as string[] : (defaults.plattformen || ["instagram"]),
    ziel: String(source.ziel || defaults.ziel || ""),
    hook: String(source.hook || defaults.hook || ""),
    template_type: String(source.template_type || defaults.template_type || ""),
    prompt: {
      prompt_text_ki: String((source.prompt as Record<string, unknown>)?.prompt_text_ki || defaults.prompt?.prompt_text_ki || ""),
      prompt_bild_ki: String((source.prompt as Record<string, unknown>)?.prompt_bild_ki || defaults.prompt?.prompt_bild_ki || ""),
      prompt_video_ki: String((source.prompt as Record<string, unknown>)?.prompt_video_ki || defaults.prompt?.prompt_video_ki || ""),
    },
    hashtags: Array.isArray(source.hashtags) ? source.hashtags as string[] : defaults.hashtags,
    posting_time: source.posting_time ? String(source.posting_time) : defaults.posting_time,
    expected_engagement_rate: source.expected_engagement_rate ? String(source.expected_engagement_rate) : defaults.expected_engagement_rate,
    target_segments: Array.isArray(source.target_segments) ? source.target_segments as string[] : defaults.target_segments,
    success_metrics: source.success_metrics ? source.success_metrics as ContentPiece["success_metrics"] : defaults.success_metrics,
    seo_keywords: Array.isArray(source.seo_keywords) ? source.seo_keywords as string[] : defaults.seo_keywords,
    expected_traffic: source.expected_traffic ? String(source.expected_traffic) : defaults.expected_traffic,
  };
}

function distributeContentPieces(pieces: ContentPiece[], pkg: string): ContentPiece[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const counts = getContentCount(pkg);
  
  const sortedPieces = [...pieces].sort((a, b) => {
    const formatOrder: Record<string, number> = { "Erklaervideo": 0, "Reel": 1, "Artikel": 2, "Story": 3, "Post": 4 };
    return (formatOrder[a.format] ?? 5) - (formatOrder[b.format] ?? 5);
  });
  
  let pieceIndex = 0;
  const result: ContentPiece[] = [];
  const postsPerWeek = Math.ceil(counts.posts / 4);
  const weekDays = [1, 3, 5, 2, 4];
  
  let postCount = 0;
  let storyCount = 0;
  let reelCount = 0;
  let articleCount = 0;
  let videoCount = 0;
  
  const articleDays = [7, 14, 21, 28].filter(d => d <= daysInMonth);
  
  for (let week = 0; week < 4; week++) {
    const weekStart = Math.floor((week * daysInMonth) / 4) + 1;
    const weekEnd = Math.floor(((week + 1) * daysInMonth) / 4);
    let weekIdx = week * 3;
    
    for (let i = 0; i < postsPerWeek && postCount < counts.posts && pieceIndex < sortedPieces.length; i++) {
      const dayIndex = (weekIdx + i) % weekDays.length;
      const day = weekDays[dayIndex] ?? 1;
      const actualDay = Math.min(weekStart + day, daysInMonth);
      
      const defaults: Partial<ContentPiece> = {
        datum: `${year}-${String(month + 1).padStart(2, "0")}-${String(actualDay).padStart(2, "0")}`,
        posting_time: i % 2 === 0 ? "09:00" : "17:00",
        plattformen: postCount % 2 === 0 ? ["instagram", "facebook"] : ["linkedin"],
      };
      
      result.push(createContentPiece(sortedPieces[pieceIndex++] as unknown as Record<string, unknown>, defaults));
      postCount++;
    }
    
    for (let day = weekStart; day <= weekEnd && day <= daysInMonth && storyCount < counts.stories; day++) {
      const dayOfWeek = new Date(year, month, day).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      if (pieceIndex < sortedPieces.length) {
        const defaults: Partial<ContentPiece> = {
          datum: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          format: "Story",
          posting_time: "10:00",
        };
        result.push(createContentPiece(sortedPieces[pieceIndex++] as unknown as Record<string, unknown>, defaults));
        storyCount++;
      }
    }
    
    if (week < counts.reels && pieceIndex < sortedPieces.length) {
      const defaults: Partial<ContentPiece> = {
        datum: `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(weekStart + 3, daysInMonth)).padStart(2, "0")}`,
        format: "Reel",
        posting_time: "18:00",
      };
      result.push(createContentPiece(sortedPieces[pieceIndex++] as unknown as Record<string, unknown>, defaults));
      reelCount++;
    }
  }
  
  for (let i = 0; i < articleDays.length && articleCount < counts.articles && pieceIndex < sortedPieces.length; i++) {
    const defaults: Partial<ContentPiece> = {
      datum: `${year}-${String(month + 1).padStart(2, "0")}-${String(articleDays[i]).padStart(2, "0")}`,
      format: "Artikel",
      posting_time: "08:00",
      seo_keywords: ["keyword1", "keyword2", "keyword3"],
    };
    result.push(createContentPiece(sortedPieces[pieceIndex++] as unknown as Record<string, unknown>, defaults));
    articleCount++;
  }
  
  if (pkg === "enterprise" && counts.videos > 0 && pieceIndex < sortedPieces.length) {
    const defaults: Partial<ContentPiece> = {
      datum: `${year}-${String(month + 1).padStart(2, "0")}-15`,
      format: "Erklaervideo",
      posting_time: "16:00",
      prompt: {
        prompt_text_ki: "",
        prompt_bild_ki: "",
        prompt_video_ki: "Erstelle ein 45-60 Sekunden Erklärvideo. Szenen: 1) Intro mit Logo, 2) Problem-Beschreibung, 3) Lösung vorstellen, 4) Call-to-Action. Musik: Professionell, modern. Keine realen Personen.",
      },
    };
    result.push(createContentPiece(sortedPieces[pieceIndex++] as unknown as Record<string, unknown>, defaults));
    videoCount++;
  }
  
  return result;
}

export async function runRedaktionsplanWorkflow(input: RedaktionsplanInput): Promise<RedaktionsplanResult> {
  console.log(`[Redaktionsplan] Starting workflow for customer: ${input.customer_id}, package: ${input.package}`);
  
  const planDetails = getPlanDetails(input.package);
  
  const company = await getCompanyProfile(input.customer_id);
  if (!company) {
    throw new Error(`Company profile not found: ${input.customer_id}`);
  }
  
  const competitiveData = await getCompetitiveAnalysis(input.customer_id);
  console.log(`[Redaktionsplan] Loaded ${competitiveData.length} competitive analysis entries`);
  
  const existingPlan = await getExistingRedaktionsplan(input.customer_id);
  if (existingPlan && input.action === "confirm") {
    console.log(`[Redaktionsplan] Deleting existing plan for: ${input.customer_id}`);
    await deleteRedaktionsplan(input.customer_id);
  }
  
  console.log("[Redaktionsplan] Step 1: Generiere strategischen Plan...");
  const part1Output = await generateRedaktionsplanPart1(company, competitiveData, planDetails, input.feedback);
  
  console.log("[Redaktionsplan] Step 2: Generiere Content-Pieces mit KI-Prompts...");
  const part2Output = await generateRedaktionsplanPart2(part1Output, planDetails, company, competitiveData);
  
  console.log("[Redaktionsplan] Step 3: Generiere strukturiertes JSON...");
  const contentPieces = await generateRedaktionsplanPart3(part2Output, input.package);
  
  console.log(`[Redaktionsplan] Step 4: Verteile Content-Pieces über den Monat...`);
  const distributedPieces = distributeContentPieces(contentPieces, input.package);
  
  const title = `${company.company_name} ${new Date().toLocaleString("de-DE", { month: "long", year: "numeric" })}`;
  
  console.log("[Redaktionsplan] Step 5: Speichere in Datenbank...");
  await createRedaktionsplan(input.customer_id, title, distributedPieces);
  
  return {
    customer_id: input.customer_id,
    company_name: company.company_name,
    package: input.package,
    title,
    content_pieces: distributedPieces,
    created_at: new Date().toISOString(),
  };
}
