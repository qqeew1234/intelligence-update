# 지능 업데이트 (Intelligence Update)

> **"AI, 오늘 또 똑똑해졌나?"**  
> 개발자(API·SDK·코딩툴)와 일반 직장인(주요 AI 서비스 신기능)을 위한 **노이즈 없는 실시간 AI 공식 변경점 피드**

- **Live URL**: [https://ai.yunyun.page](https://ai.yunyun.page)
- **GitHub Repository**: [https://github.com/qqeew1234/intelligence-update](https://github.com/qqeew1234/intelligence-update)

## 주요 기능

- **4계층 공식 소스 자동 수집**:
  - 공식 블로그 RSS (`OpenAI News`, `Google AI Blog`, `Google DeepMind`, `Hugging Face Blog`)
  - GitHub Releases Atom (`Claude Code`, `Gemini CLI`, `OpenAI Node SDK`, `Anthropic TS SDK`, `Ollama`, `Vercel AI SDK`)
  - 모델 카탈로그 JSON API (`OpenRouter Models` 신규 모델 및 가격/컨텍스트)
  - 공식 Changelog Diff (`Cursor Changelog`)
- **변경점 감지 & 스마트 요약**:
  - 스냅샷 비교로 중복·미변경 항목은 건너뛰고 새 업데이트만 처리
  - `GEMINI_API_KEY` 또는 `OPENAI_API_KEY`가 있으면 한국어 3줄 요약·중요도·대상 자동 분류 (키가 없으면 규칙 기반 요약으로 즉시 동작)
- **맞춤 필터링 UI**:
  - `[전체 / 개발자 / 일반·직장인]`, `[메이저만 보기]`, `[내 구독 툴만]`, 벤더 필터 및 검색 지원

## 아키텍처 (Cloudflare Workers + vinext)

- **런타임**: Next.js App Router on Cloudflare Workers (`vinext` + `@cloudflare/vite-plugin`)
- **저장소**: Cloudflare KV (`INTELLIGENCE_KV`, 로컬 CLI 실행 시 `data/store.json` 폴백)
- **자동 수집**: Cloudflare Workers Cron Trigger (`0 * * * *`, `worker/index.ts`의 `scheduled` 핸들러)
- **자동 배포**: GitHub `main` 브랜치 연동 Cloudflare Workers Builds

### 주요 파일

- `worker/index.ts` — Cloudflare Worker 엔트리포인트 (`fetch` 위임 + 매시간 `scheduled` 크론 동기화)
- `wrangler.jsonc` — Worker 이름, 커스텀 도메인(`ai.yunyun.page`), KV 바인딩, 크론 트리거 설정
- `src/lib/sources.ts` — 12개 공식 AI 소스 설정
- `src/lib/collectors.ts` — RSS/Atom/JSON API/HTML Changelog 수집기
- `src/lib/summarizer.ts` — Gemini / OpenAI 요약 및 규칙 기반 폴백 분류기
- `src/lib/sync.ts` — 병렬 수집, 중복 제거, 스냅샷 저장 오케스트레이터
- `src/lib/storage.ts` — Cloudflare KV(`INTELLIGENCE_KV`) 및 로컬 JSON(`data/store.json`) 듀얼 저장소
- `src/app/api/*` — `/api/updates`, `/api/sync`, `/api/sources` 엔드포인트

## 로컬 개발 & 배포

```bash
# 1. 의존성 설치
npm install

# 2. (선택) AI 한국어 요약을 켜려면 .env.local 또는 Worker Secret에 키 입력
cp .env.example .env.local

# 3. 개발 서버 실행 (vinext + workerd)
npm run dev

# 4. 타입체크 및 Cloudflare Workers 빌드
npm run typecheck
npm run build

# 5. Cloudflare Workers 배포
npm run deploy
```

CLI에서 로컬 `data/store.json` 기준으로 동기화를 테스트하려면:

```bash
npm run sync
```
