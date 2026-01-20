# rf_workflows

Node.js/Bun-Portierung eines n8n SEO Keyword Research Workflows.

## Installation

```bash
bun install
```

## Development

```bash
bun run dev
```

## Docker Deployment

### Mit Browserless Service (Empfohlen)

```bash
# Start both rf_workflows and browserless
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Konfiguration

Kopiere `.env.example` zu `.env` und fülle die erforderlichen API-Keys aus:

```bash
cp .env.example .env
```

**Erforderliche Environment Variables:**
- `OPENAI_API_KEY` - OpenAI API Key
- `DATAFORSEO_LOGIN` - DataForSEO Login
- `DATAFORSEO_PASSWORD` - DataForSEO Passwort
- `APIFY_API_TOKEN` - Apify API Token
- `BROWSERLESS_WS_ENDPOINT` - Browserless WebSocket (wird automatisch gesetzt)

### Services

- **rf_workflows**: Port 3555
- **browserless**: Port 3100 (intern 3000)

### Browserless Konfiguration

Das browserless Service wird automatisch gestartet und ist über `ws://browserless:3000/?token=6R0W53R135510` im Docker-Netzwerk erreichbar.

**Features:**
- 5 concurrent sessions
- 60s connection timeout
- Chrome pre-boot enabled
- Health checks aktiviert

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
