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
- **APIs**: OpenAI (GPT-5-mini, GPT-4.1-nano), DataForSEO, Apify, Puppeteer
- **Sprache**: TypeScript (strict mode)
- **Docker**: docker-compose mit Browserless service

## Projektstruktur

```
src/
├── routes/         # Elysia API Endpunkte (index, health, debug, workflow)
├── services/       # Business Logic (workflow, openai, dataforseo, crawler)
├── constants/      # Blacklists, Filters
├── types/          # TypeScript Type Definitions
└── utils/          # Helper Functions
```

**Wichtige Dateien:**
- `src/services/workflow.ts:24` - `runSEOKeywordWorkflow()` Hauptfunktion
- `src/services/openai.ts:467` - `isSingleCompanyWebsite()` KI-Validator
- `src/services/crawler.ts:161` - Apify Scraper mit Circuit Breaker
- `src/services/scraperQueue.ts` - Globale Queue für paralleles Scraping (max 4 gleichzeitig)
- `src/constants/domainBlacklist.ts` - Portal-Filterung

## Build/Test/Lint Commands

```bash
# Development mit Hot-Reload
bun run dev

# Production Start
bun run start
# oder direkt:
bun run index.ts

# TypeScript Type-Check (wichtig vor Commits!)
bun run typecheck

# Docker Commands
docker-compose up -d              # Start services (rf_workflows + browserless)
docker-compose logs -f            # View logs
docker-compose down               # Stop services
docker-compose restart rf_workflows  # Restart main service

# Einzelne Tests laufen nicht - keine Test-Suite konfiguriert
# API Tests manuell via curl oder Postman gegen localhost:3555
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

## Code Style Guidelines

### TypeScript & Types
- **Strict Mode**: Alle TypeScript strict flags aktiv (siehe tsconfig.json)
- **Explicit Types**: Funktionsparameter und Return-Types immer typisieren
- **Type Imports**: `import type { ... }` für Type-only imports nutzen
- **No Any**: Vermeide `any`, nutze `unknown` oder spezifische Types
- **Interface vs Type**: Für Objekte `type` bevorzugen (konsistent im Projekt)

### Imports
- **Reihenfolge**: 1) Type imports, 2) External dependencies, 3) Internal modules

### Naming Conventions
- **Files**: kebab-case (`keyword-templates.ts`, `domain-blacklist.ts`)
- **Functions**: camelCase (`extractKeywords`, `findLocation`)
- **Constants**: SCREAMING_SNAKE_CASE (`MODEL`, `GERMANY_LOCATION_CODE`)
- **Types/Interfaces**: PascalCase (`WorkflowInput`, `KeywordResult`)
- **Private Functions**: camelCase ohne Prefix (nicht `_private`)

### Error Handling
- Console Logging: `console.log("[Service] Message")`
- Try-Catch für API Calls mit Fallback oder re-throw
- Graceful Degradation bevorzugen (z.B. Apify Circuit Breaker)

### Code Organization
- **Services**: Business Logic in `src/services/`
- **Routes**: API Endpunkte in `src/routes/` (Elysia Router)
- **Types**: Zentral in `src/types/index.ts`
- **Constants**: Separate Dateien in `src/constants/` (z.B. Blacklists, Filters)
- **Utils**: Helper Functions in `src/utils/`

### Comments & Documentation
- **Minimal Comments**: Code sollte self-explanatory sein
- **JSDoc für exported Functions**: Nur wenn Verhalten nicht offensichtlich
- **Deutsche Kommentare**: Für Business Logic (SEO Keywords, lokale Begriffe)
- **Englische Kommentare**: Für technische Aspekte

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
- Scraper Queue: Max 4 parallele Scrapes gleichzeitig, reste werden gequeued
- Scraper Queue: Globale Singleton Instance (`src/services/scraperQueue.ts`)
- Fallback: Keywords ohne Suchvolumen werden behalten
- Fallback: Apify wenn Puppeteer scheitert
- Fallback: Heuristik wenn Company-Validator scheitert
- Logging auf Deutsch für n8n-Kompatibilität

### Apify Circuit Breaker
- Detektiert `actor-memory-limit-exceeded` Errors
- Stoppt automatisch weitere Apify Calls für 60s
- Verhindert Cascade Failures bei Memory-Limit
- Apify Memory: 2048MB (muss power of 2 sein: 512, 1024, 2048, 4096)

## Debugging

- `/debug/dataforseo` Endpoint für Location/Search Volume Tests
- `console.log` mit `[Service]` Prefix für Tracing
- `logResponse: true` in `fetchDataForSEO` für API-Debugging

## OpenAI Models
- **Normal Model**: `gpt-5-mini` (für komplexe Extraktion und Validierung)
- **Small Model**: `gpt-4.1-nano` (für einfache Klassifikation)
- **WICHTIG**: DONT USE gpt-4o!! IT'S DEPRECATED
