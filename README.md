# Intelligence Update

> **Official AI releases & Gemini-synthesized rumor radar — zero fluff.**

- **Live URL**: [https://ai.yunyun.page](https://ai.yunyun.page)
- **GitHub Repository**: [https://github.com/qqeew1234/intelligence-update](https://github.com/qqeew1234/intelligence-update)

## Features

- **Dual-Track Intelligence Feed (28 Sources)**:
  - **Official Updates (16 sources)**:
    - Official Blogs RSS (`OpenAI News`, `Google AI Blog`, `Google DeepMind`, `Hugging Face Blog`)
    - GitHub Releases Atom (`Claude Code`, `Gemini CLI`, `OpenAI Codex CLI`, `Cline`, `OpenAI Node SDK`, `Anthropic TS SDK`, `Ollama`, `Vercel AI SDK`, `vLLM`, `llama.cpp`)
    - Model Catalog JSON API (`OpenRouter Models` pricing & context tracking)
    - Official Changelog Diff (`Cursor Changelog`)
  - **Rumor Radar (12 sources)**:
    - Leaks, insider reporting, deep technical analysis, and community signals (`TestingCatalog`, `The Decoder`, `TechCrunch AI`, `The Verge AI`, `MIT Tech Review AI`, `Ars Technica`, `SemiAnalysis`, `Interconnects`, `Simon Willison`, `Hacker News AI`, `Lobste.rs AI`, `HF Daily Papers`)
- **Cross-Source Deduplication & Corroboration**:
  - **Stage 1 (Canonical URL Matching)**: Strips tracking parameters and normalizes URLs so links shared across multiple feeds merge into `corroboratingSources` rather than creating duplicate cards.
  - **Stage 2 (Gemini Semantic Clustering & Briefing Synthesis)**: Evaluates rumors in batches via `@google/genai` Interactions API (`gemini-3.5-flash-lite`, `store: false`), clusters overlapping stories across outlets (`duplicateOfId`), upgrades corroborated signals to `Multiple Reports`, and synthesizes each item into a neutral headline, summary bullets, `Core Claim`, `Why It Matters`, `Evidence / Basis`, and `Caveat / Unconfirmed`.
- **Live Auto-Sync & Auto-Polling**:
  - Alternating Cloudflare Workers Cron Trigger (`*/30 * * * *`: `:00` for Official Updates, `:30` for Rumor Radar)
  - Client auto-polling every 5 minutes + on tab visibility return, with live relative timestamps

## Architecture (Cloudflare Workers + vinext)

- **Runtime**: Next.js App Router on Cloudflare Workers (`vinext` + `@cloudflare/vite-plugin`)
- **Storage**: Cloudflare KV (`INTELLIGENCE_KV`, key `store:v2`, with local `data/store.json` fallback for CLI runs)
- **Cron**: `worker/index.ts` delegates HTTP requests to `vinext/server/fetch-handler` and dispatches `runSync({ track })` per cron schedule
- **CI/CD**: GitHub `main` branch connected to Cloudflare Workers Builds

## Local Development & Deployment

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Enable Gemini Rumor Radar synthesis locally
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
