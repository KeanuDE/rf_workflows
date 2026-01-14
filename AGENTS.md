# AGENTS.md - rf_workflows

## Projektübersicht

Dieses Projekt ist eine Node.js/Bun-Portierung eines n8n SEO Keyword Research Workflows. Es führt automatisierte SEO-Keyword-Recherchen für lokale Unternehmen durch, einschließlich:
- Standort- und Branchenerkennung via Website-Crawling
- Keyword-Extraktion aus Firmenbeschreibungen und Dienstleistungen
- Generierung lokaler SEO-Synonyme
- Suchvolumen-Abfrage bei DataForSEO
- SERP-Analyse zur Identifikation von Wettbewerbern

## Tech Stack

- **Runtime**: Bun 1.2+
- **Framework**: Elysia (Web-Framework)
- **APIs**: OpenAI (GPT-4o-mini), DataForSEO, Apify, Puppeteer
- **Sprache**: TypeScript

## Projektstruktur

```
rf_workflows/
├── src/
│   ├── routes/                  # Elysia Route-Module (grouped by feature)
│   │   ├── index.ts             # Basis-Routen (/)
│   │   ├── health.ts            # Health Check (/health)
│   │   ├── debug.ts             # Debug Endpunkte (/debug)
│   │   └── workflow.ts          # Workflow API (/workflow)
│   ├── services/
│   │   ├── workflow.ts          # Hauptworkflow-Orchestrierung
│   │   ├── openai.ts            # OpenAI Agenten für Keyword-Extraktion
│   │   ├── dataforseo.ts        # DataForSEO API Wrapper
│   │   └── crawler.ts           # Website-Crawling (Puppeteer + Apify)
│   └── types/
│       └── index.ts             # TypeScript Interfaces
├── index.ts                      # Elysia Server Setup
├── workflow.json                 # Original n8n Workflow (Referenz)
├── package.json
└── tsconfig.json
```

## Wichtige Dateien

- `src/routes/index.ts:1` - Basis-Routen (`/`)
- `src/routes/health.ts:1` - Health Check (`/health`)
- `src/routes/debug.ts:1` - Debug Endpunkte (`/debug`)
- `src/routes/workflow.ts:1` - Workflow API (`/workflow`)
- `src/services/workflow.ts:24` - `runSEOKeywordWorkflow()` Hauptfunktion
- `src/services/openai.ts:11` - OpenAI Modell-Konfiguration
- `src/services/openai.ts:453` - `isSingleCompanyWebsite()` KI-Validator
- `src/services/openai.ts:523` - `validateCompanyDomains()` Batch-Validator
- `src/services/dataforseo.ts:9` - DataForSEO API Base URL
- `src/services/crawler.ts:20` - Browserless WebSocket Endpoint

## Verfügbare Scripts

```bash
# Development mit Hot-Reload
bun run dev

# Production Start
bun run index.ts

# TypeScript Type-Check
bun run typecheck
```

## API Endpunkte

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/` | GET | API Infos |
| `/health` | GET | Health Check mit Env-Status |
| `/debug/dataforseo` | GET | DataForSEO Test-Endpunkt |
| `/workflow` | POST | Workflow ausführen (ein Objekt oder Array) |

## Workflow-Schritte

1. **Location-Finder**: Website crawlen, Standort und Branche extrahieren
2. **Location Code**: DataForSEO Google Ads Locations API
3. **Keyword Extraction**: Parallel aus Beschreibung und Services
4. **Merge & Limit**: Max 20 Keywords pro Quelle, dann zusammenführen
5. **Local SEO Keywords**: Synonyme mit Ortsnamen generieren
6. **Validate**: Keywords nach Branchen-Relevanz filtern
7. **Search Volume**: DataForSEO Batched API (max 40 Keywords)
8. **SERP Results**: Top 5 Keywords SERP-Check mit Domain-Filterung
9. **Company Validation**: AI-Prüfung ob Domains echte Firmen sind (nicht Portale)

## Domain-Blacklist

In `src/services/workflow.ts:200-268` definierte Blacklist für:
- Vergleichsportale (Check24, MyHammer, etc.)
- Branchenverzeichnisse (Gelbe Seiten, Yelp, etc.)
- Job-Portale (Indeed, Stepstone, etc.)
- Überregionale Infoseiten

## KI-Company-Validator

In `src/services/openai.ts:453-548` implementierter Validator:
- Prüft ob eine Domain eine einzelne Firma oder ein Branchenportal ist
- Crawlt die Website und analysiert den Content mit GPT-4o-mini
- Erkennt einzelne Firmen durch: Impressum, "Über uns", Team-Seite, eigene Projekte
- Erkennt Portale durch: "für Partner werden", hunderte Einträge, "finden Sie in Stadt"
- Fallback-Heuristik bei API-Fehlern

## Coding-Konventionen

- TypeScript mit strict typing
- Keine zusätzlichen Kommentare außer wo nötig
- Deutsche Keywords und Prompts für lokale SEO
- Elysia t-Validierung für API-Inputs
- `OptionalNullable` Helper für nullable optionale Felder

## Umgebungsvariablen

```env
OPENAI_API_KEY=sk-...
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
APIFY_API_TOKEN=...
BROWSERLESS_WS_ENDPOINT=ws://browserless:3000/?token=...
PORT=3000
```

## Fehlerbehandlung

- Rate Limiting: 3s Pause zwischen DataForSEO Batches
- Rate Limiting: 2s Pause zwischen SERP Requests
- Rate Limiting: 1s Pause zwischen Company-Validierung
- Fallback: Keywords ohne Suchvolumen werden behalten
- Fallback: Apify wenn Puppeteer scheitert
- Fallback: Heuristik wenn Company-Validator scheitert
- Logging auf Deutsch für n8n-Kompatibilität

## Debugging

- `/debug/dataforseo` Endpoint für Location/Search Volume Tests
- `console.log` mit `[Service]` Prefix für Tracing
- `logResponse: true` in `fetchDataForSEO` für API-Debugging
