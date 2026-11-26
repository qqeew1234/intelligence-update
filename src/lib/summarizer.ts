import { getEnvVar } from "./env";
import { compactWhitespace } from "./text";
import type {
  Audience,
  Category,
  Importance,
  RawCandidate,
  SourceConfig,
  UpdateItem,
} from "./types";

interface LlmClassification {
  is_meaningful?: boolean;
  importance?: Importance;
  audiences?: Audience[];
  category?: Category;
  titleKo?: string;
  summaryKo?: string[];
  devImpact?: string;
}

export async function getActiveLlmProvider(): Promise<"gemini" | "openai" | "rule"> {
  if (await getEnvVar("GEMINI_API_KEY")) return "gemini";
  if (await getEnvVar("OPENAI_API_KEY")) return "openai";
  return "rule";
}

function buildPrompt(source: SourceConfig, candidate: RawCandidate): string {
  return `당신은 AI 기술/제품 업데이트 전문 큐레이터입니다.
아래 공식 소스에서 수집된 새 업데이트를 분석해 반드시 유효한 JSON 객체 하나만 반환하세요. (마크다운 코드블록 금지)

[소스 정보]
- 서비스/벤더: ${source.name} (${source.vendor})
- 기본 타깃: ${source.defaultAudiences.join(", ")}
- 원문 제목: ${candidate.title}
- 원문 내용:
${candidate.rawText.slice(0, 2000)}

[반환 JSON 스키마]
{
  "is_meaningful": true,
  "importance": "major" | "minor" | "patch",
  "audiences": ["developer" | "general"],
  "category": "new_model" | "new_feature" | "pricing" | "deprecation" | "coding_tool" | "bugfix" | "research",
  "titleKo": "한국어 핵심 제목 (45자 이내, 직관적으로)",
  "summaryKo": ["핵심 변경점 1줄", "실무/사용자 체감 변화 1줄", "세부 참고사항 1줄 (선택)"],
  "devImpact": "개발자 API/SDK/코딩툴 영향 1줄 요약 (개발자 관련 없으면 빈 문자열)"
}

[분류 기준]
- major: 신규 모델 출시, 대형 신기능, API 가격/한도/지원종료(deprecation) 변경, 주요 메이저 버전(vX.0.0)
- minor: 일반 기능 추가, 새 툴/옵션 지원, OpenRouter 신규 모델 등록, 일반 블로그 발표
- patch: 단순 버그 수정, 의존성 업데이트, 사소한 패치 버전`;
}

function parseLlmJson(text: string): LlmClassification | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as LlmClassification;
  } catch {
    return null;
  }
}

async function callGemini(prompt: string, apiKey: string): Promise<LlmClassification | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return raw ? parseLlmJson(raw) : null;
}

async function callOpenAI(prompt: string, apiKey: string): Promise<LlmClassification | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  return raw ? parseLlmJson(raw) : null;
}

function classifyByRules(source: SourceConfig, candidate: RawCandidate): {
  importance: Importance;
  audiences: Audience[];
  category: Category;
  titleKo: string;
  summaryKo: string[];
  devImpact?: string;
} {
  const haystack = `${candidate.title}\n${candidate.rawText}`.toLowerCase();

  let importance: Importance = "minor";
  const semverMajor = /\bv([1-9]\d*)\.0\.0\b/.test(candidate.title);
  const semverPatch = /\bv\d+\.\d+\.[1-9]\d*\b/.test(candidate.title);

  if (
    semverMajor ||
    /\b(introducing|announcing|launch|launching|release|released|deprecat|pricing|price cut|gpt-5|gpt-4|claude|gemini|o3|o4|sonnet|opus)\b/.test(
      haystack
    )
  ) {
    importance = "major";
  } else if (
    semverPatch ||
    (/\b(fix|fixes|bug|patch|chore|bump|typo)\b/.test(candidate.title.toLowerCase()) &&
      !/\b(feat|feature|add|support|new)\b/.test(candidate.title.toLowerCase()))
  ) {
    importance = "patch";
  }

  let category: Category = source.defaultCategory;
  if (/\b(deprecat|sunset|retire|end of life)\b/.test(haystack)) {
    category = "deprecation";
  } else if (/\b(pricing|price|cost|token|rate limit)\b/.test(haystack)) {
    category = "pricing";
  } else if (
    source.type === "openrouter_models" ||
    /\b(new model|model release|weights|checkpoint|openrouter)\b/.test(haystack)
  ) {
    category = "new_model";
  } else if (importance === "patch") {
    category = "bugfix";
  } else if (/\b(paper|benchmark|research|reasoning|alignment)\b/.test(haystack)) {
    category = "research";
  }

  const audiences = new Set<Audience>(source.defaultAudiences);
  if (/\b(api|sdk|cli|mcp|typescript|python|token|endpoint|webhook)\b/.test(haystack)) {
    audiences.add("developer");
  }
  if (
    /\b(chatgpt|claude\.ai|gemini app|workspace|assistant|search|image|voice|consumer)\b/.test(
      haystack
    )
  ) {
    audiences.add("general");
  }

  const lines = candidate.rawText
    .split(/\n+/)
    .map((line) => compactWhitespace(line.replace(/^[-*•#]+\s*/, "")))
    .filter((line) => line.length >= 12 && line.toLowerCase() !== candidate.title.toLowerCase());

  const summaryKo: string[] = [];
  if (source.type === "openrouter_models") {
    const ctxLine = lines.find((l) => l.startsWith("Context Length:"));
    const priceLine = lines.find((l) => l.startsWith("Pricing:"));
    const descLine = lines.find((l) => l.startsWith("Description:"));
    if (ctxLine) summaryKo.push(ctxLine.replace("Context Length:", "컨텍스트 한도:"));
    if (priceLine) summaryKo.push(priceLine.replace("Pricing:", "토큰 단가:"));
    if (descLine) {
      summaryKo.push(descLine.replace("Description:", "").trim().slice(0, 160));
    }
  } else {
    for (const line of lines) {
      if (summaryKo.length >= 3) break;
      const truncated = line.length > 160 ? `${line.slice(0, 157)}...` : line;
      if (!summaryKo.includes(truncated)) summaryKo.push(truncated);
    }
  }

  if (summaryKo.length === 0) {
    summaryKo.push(`${source.name} 공식 채널에 새 업데이트가 등록되었습니다.`);
  }

  const devImpact = audiences.has("developer")
    ? source.defaultCategory === "coding_tool"
      ? `${source.name} 버전/기능 변경점 확인 필요`
      : "API/모델 사양 및 공식 문서 변경 여부 확인"
    : undefined;

  return {
    importance,
    audiences: Array.from(audiences),
    category,
    titleKo: candidate.title,
    summaryKo,
    devImpact,
  };
}

function normalizeImportance(val: unknown, fallback: Importance): Importance {
  return val === "major" || val === "minor" || val === "patch" ? val : fallback;
}

function normalizeCategory(val: unknown, fallback: Category): Category {
  const allowed: Category[] = [
    "new_model",
    "new_feature",
    "pricing",
    "deprecation",
    "coding_tool",
    "bugfix",
    "research",
  ];
  return typeof val === "string" && allowed.includes(val as Category) ? (val as Category) : fallback;
}

function normalizeAudiences(val: unknown, fallback: Audience[]): Audience[] {
  if (!Array.isArray(val)) return fallback;
  const filtered = val.filter((v): v is Audience => v === "developer" || v === "general");
  return filtered.length > 0 ? Array.from(new Set(filtered)) : fallback;
}

export async function summarizeCandidate(
  source: SourceConfig,
  candidate: RawCandidate,
  useLlm: boolean
): Promise<{ item: UpdateItem | null; usedLlm: boolean }> {
  const nowIso = new Date().toISOString();
  const ruleFallback = classifyByRules(source, candidate);

  let llmResult: LlmClassification | null = null;
  let summarizedBy: "gemini" | "openai" | "rule" = "rule";

  if (useLlm) {
    const geminiKey = await getEnvVar("GEMINI_API_KEY");
    const openaiKey = await getEnvVar("OPENAI_API_KEY");
    const prompt = buildPrompt(source, candidate);

    try {
      if (geminiKey) {
        llmResult = await callGemini(prompt, geminiKey);
        if (llmResult) summarizedBy = "gemini";
      } else if (openaiKey) {
        llmResult = await callOpenAI(prompt, openaiKey);
        if (llmResult) summarizedBy = "openai";
      }
    } catch {
      llmResult = null;
      summarizedBy = "rule";
    }
  }

  if (llmResult?.is_meaningful === false) {
    return { item: null, usedLlm: summarizedBy !== "rule" };
  }

  const summaryKo =
    Array.isArray(llmResult?.summaryKo) && llmResult.summaryKo.length > 0
      ? llmResult.summaryKo.map((s) => compactWhitespace(String(s))).filter(Boolean).slice(0, 3)
      : ruleFallback.summaryKo;

  const item: UpdateItem = {
    id: candidate.externalId,
    sourceId: source.id,
    sourceName: source.name,
    vendor: source.vendor,
    title: candidate.title,
    titleKo: llmResult?.titleKo?.trim() || ruleFallback.titleKo,
    summaryKo,
    importance: normalizeImportance(llmResult?.importance, ruleFallback.importance),
    audiences: normalizeAudiences(llmResult?.audiences, ruleFallback.audiences),
    category: normalizeCategory(llmResult?.category, ruleFallback.category),
    devImpact: llmResult?.devImpact?.trim() || ruleFallback.devImpact,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    collectedAt: nowIso,
    summarizedBy,
  };

  return { item, usedLlm: summarizedBy !== "rule" };
}
