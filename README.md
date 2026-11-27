# Intelligence Update

> **Official AI releases & Gemini-evaluated rumor radar — zero fluff.**

- **Live URL**: [https://ai.yunyun.page](https://ai.yunyun.page)
- **GitHub Repository**: [https://github.com/qqeew1234/intelligence-update](https://github.com/qqeew1234/intelligence-update)

## Features

- **Dual-Track Intelligence Feed**:
  - **Official Updates (12 sources)**:
    - Official Blogs RSS (`OpenAI News`, `Google AI Blog`, `Google DeepMind`, `Hugging Face Blog`)
    - GitHub Releases Atom (`Claude Code`, `Gemini CLI`, `OpenAI Node SDK`, `Anthropic TS SDK`, `Ollama`, `Vercel AI SDK`)
    - Model Catalog JSON API (`OpenRouter Models` pricing & context tracking)
    - Official Changelog Diff (`Cursor Changelog`)
  - **Rumor Radar (6 sources)**:
    - Unreleased leaks, insider scoops, and community buzz (`TestingCatalog`, `The Decoder`, `TechCrunch AI`, `The Verge AI`, `Hacker News AI`, `HF Daily Papers`)
- **Gemini Credibility & Evidence Evaluation (`@google/genai` Interactions API)**:
  - Evaluates rumor items in structured batches using **`gemini-3.5-flash-lite`** (configurable via `GEMINI_RUMOR_MODEL`)
  - Produces `credibility` (`high` / `medium` / `low` / `unverified`), `credibilityScore` (`0–100`), `evidenceBasis`, `claim`, `evidenceSummary`, and `caveat`
  - Automatically falls back to deterministic heuristic evaluation when `GEMINI_API_KEY` is not set
- **Live Auto-Sync & Auto-Polling**:
  - Hourly Cloudflare Workers Cron Trigger (`0 * * * *`)
  - Client auto-polling every 5 minutes + on tab visibility return, with live relative timestamps

## Architecture (Cloudflare Workers + vinext)

- **Runtime**: Next.js App Router on Cloudflare Workers (`vinext` + `@cloudflare/vite-plugin`)
- **Storage**: Cloudflare KV (`INTELLIGENCE_KV`, key `store:v2`, with local `data/store.json` fallback for CLI runs)
- **Cron**: `worker/index.ts` delegates HTTP requests to `vinext/server/fetch-handler` and runs `runSync()` on `0 * * * *`
- **CI/CD**: GitHub `main` branch connected to Cloudflare Workers Builds

## Local Development & Deployment

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Enable Gemini Rumor Radar evaluation locally
cp .env.example .env.local

# 3. Start local dev server (vinext + workerd)
npm run dev

# 4. Typecheck and build Worker bundle
npm run typecheck
npm run build

# 5. Deploy to Cloudflare Workers
npm run deploy
```

To enable Gemini evaluation in production:

```bash
npx wrangler secret put GEMINI_API_KEY
```

To test a manual CLI sync locally (`data/store.json`):

```bash
npm run sync
```
