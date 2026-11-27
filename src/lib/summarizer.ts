import { GoogleGenAI } from "@google/genai";
import { getEnvVar } from "./env";
import { compactWhitespace } from "./text";
import type {
  Audience,
  Category,
  CorroboratingSource,
  CredibilityLevel,
  EvidenceBasis,
  Importance,
  RawCandidate,
  RumorEvaluation,
  RumorType,
  SourceConfig,
  UpdateItem,
} from "./types";

export const DEFAULT_GEMINI_RUMOR_MODEL = "gemini-3.5-flash-lite";
const RUMOR_BATCH_SIZE = 6;

export interface ExistingRumorContext {
  id: string;
  vendor: string;
  headline: string;
  claim: string;
  sourceName: string;
}

export interface RumorMerge {
  targetId: string;
  source: CorroboratingSource;
  updatedRumor?: Partial<RumorEvaluation>;
  updatedSummary?: string[];
}

interface GeminiRumorItemResult {
  id?: string;
  is_relevant?: boolean;
  duplicateOfId?: string;
  vendor?: string;
  headline?: string;
  summary?: string[];
  importance?: Importance;
  audiences?: Audience[];
  category?: Category;
  rumorType?: RumorType;
  credibility?: CredibilityLevel;
  credibilityScore?: number;
  evidenceBasis?: EvidenceBasis;
  claim?: string;
  impact?: string;
  evidenceSummary?: string;
  caveat?: string;
}

const RUMOR_BATCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          is_relevant: { type: "boolean" },
          duplicateOfId: { type: "string" },
          vendor: { type: "string" },
          headline: { type: "string" },
          summary: { type: "array", items: { type: "string" } },
          importance: { type: "string", enum: ["major", "minor", "patch"] },
          audiences: {
            type: "array",
            items: { type: "string", enum: ["developer", "general"] },
          },
          category: {
            type: "string",
            enum: [
              "new_model",
              "new_feature",
              "pricing",
              "deprecation",
              "coding_tool",
              "bugfix",
              "research",
            ],
          },
          rumorType: {
            type: "string",
            enum: ["unreleased_leak", "insider_report", "community_buzz", "early_research"],
          },
          credibility: {
            type: "string",
            enum: ["high", "medium", "low", "unverified"],
          },
          credibilityScore: { type: "integer" },
          evidenceBasis: {
            type: "string",
            enum: [
              "code_or_ui_artifact",
              "multiple_reports",
              "named_insider",
              "single_source",
              "speculation",
            ],
          },
          claim: { type: "string" },
          impact: { type: "string" },
          evidenceSummary: { type: "string" },
          caveat: { type: "string" },
        },
        required: [
          "id",
          "is_relevant",
          "duplicateOfId",
          "vendor",
          "headline",
          "summary",
          "importance",
          "audiences",
          "category",
          "rumorType",
          "credibility",
          "credibilityScore",
          "evidenceBasis",
          "claim",
          "impact",
          "evidenceSummary",
          "caveat",
        ],
      },
    },
  },
  required: ["items"],
};

const RUMOR_SYSTEM_INSTRUCTION = `You are an AI industry intelligence editor synthesizing raw rumors, leaks, insider scoops, research papers, and community threads into concise, processed intelligence briefings.

Tasks for each candidate:
1. Relevance & Deduplication:
   - Set is_relevant = false ONLY for obvious spam or items unrelated to AI models, products, tooling, chips, or AI labs.
   - Check the provided recentRumors list AND earlier items in the current batch. If this candidate reports on the SAME underlying leak, rumor, release scoop, paper, or event as an existing item, set duplicateOfId to that matching item's exact id (otherwise set duplicateOfId to "").
   - When duplicateOfId is non-empty, synthesize updated evidenceSummary, impact, credibility, credibilityScore, and caveat reflecting the added corroboration.
2. Intelligence Briefing Synthesis (do NOT merely copy the raw title):
   - vendor: Primary AI company or ecosystem ("OpenAI", "Anthropic", "Google", "xAI", "Meta", "DeepSeek", "Cursor", "NVIDIA", "Hugging Face", or "Industry").
   - headline: Rewrite into a crisp, neutral intelligence headline (max 90 chars, no clickbait).
   - summary: 2-3 tight, synthesized English bullet points capturing the concrete technical or product substance.
   - claim: 1 crisp sentence stating the core unconfirmed or emerging claim.
   - impact: 1 concise sentence explaining why this matters for AI builders, developers, or users if confirmed.
   - evidenceSummary: 1-2 sentences evaluating the actual evidence, artifacts, or corroboration present.
   - caveat: 1 sentence stating what remains unconfirmed, speculative, or missing.
3. Credibility Rubric:
   - rumorType: "unreleased_leak" (code/UI/feature flags), "insider_report" (press sourcing), "community_buzz" (HN/Lobsters/community), or "early_research" (papers/preprints).
   - credibility & credibilityScore (0-100):
     - "high" (75-100): Verifiable code/UI artifacts, reproducible benchmarks, or multiple corroborating outlets.
     - "medium" (45-74): Plausible named-source reporting or strong technical analysis, still unconfirmed by vendor.
     - "low" (15-44): Anonymous single-source claims, vague hints, or speculative commentary.
     - "unverified" (0-60): Early claim lacking corroboration or testable artifacts.
   - evidenceBasis: "code_or_ui_artifact", "multiple_reports", "named_insider", "single_source", or "speculation".`;

export async function getRumorEvaluatorInfo(): Promise<{
  mode: "gemini" | "rule";
  model: string;
}> {
  const apiKey = await getEnvVar("GEMINI_API_KEY");
  const model = (await getEnvVar("GEMINI_RUMOR_MODEL")) || DEFAULT_GEMINI_RUMOR_MODEL;
  return {
    mode: apiKey ? "gemini" : "rule",
    model,
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
  return typeof val === "string" && allowed.includes(val as Category)
    ? (val as Category)
    : fallback;
}

function normalizeAudiences(val: unknown, fallback: Audience[]): Audience[] {
  if (!Array.isArray(val)) return fallback;
  const filtered = val.filter((v): v is Audience => v === "developer" || v === "general");
  return filtered.length > 0 ? Array.from(new Set(filtered)) : fallback;
}

function normalizeCredibility(val: unknown, fallback: CredibilityLevel): CredibilityLevel {
  return val === "high" || val === "medium" || val === "low" || val === "unverified"
    ? val
    : fallback;
}

function normalizeEvidenceBasis(val: unknown, fallback: EvidenceBasis): EvidenceBasis {
  const allowed: EvidenceBasis[] = [
    "code_or_ui_artifact",
    "multiple_reports",
    "named_insider",
    "single_source",
    "speculation",
  ];
  return typeof val === "string" && allowed.includes(val as EvidenceBasis)
    ? (val as EvidenceBasis)
    : fallback;
}

function normalizeRumorType(val: unknown, fallback: RumorType): RumorType {
  const allowed: RumorType[] = [
    "unreleased_leak",
    "insider_report",
    "community_buzz",
    "early_research",
  ];
  return typeof val === "string" && allowed.includes(val as RumorType)
    ? (val as RumorType)
    : fallback;
}

function clampScore(val: unknown, fallback: number): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(0, Math.min(100, Math.round(val)));
}

function classifyByRules(
  source: SourceConfig,
  candidate: RawCandidate
): {
  importance: Importance;
  audiences: Audience[];
  category: Category;
  headline: string;
  summary: string[];
  devImpact?: string;
} {
  const haystack = `${candidate.title}\n${candidate.rawText}`.toLowerCase();

  let importance: Importance = "minor";
  const semverMajor = /\bv([1-9]\d*)\.0\.0\b/.test(candidate.title);
  const semverPatch = /\bv\d+\.\d+\.[1-9]\d*\b/.test(candidate.title);

  if (
    semverMajor ||
    /\b(introducing|announcing|launch|launching|release|released|deprecat|pricing|price cut|gpt-5|gpt-6|gpt-4|claude|gemini|o3|o4|sonnet|opus)\b/.test(
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

  const summary: string[] = [];
  if (source.type === "openrouter_models") {
    const ctxLine = lines.find((l) => l.startsWith("Context Length:"));
    const priceLine = lines.find((l) => l.startsWith("Pricing:"));
    const descLine = lines.find((l) => l.startsWith("Description:"));
    if (ctxLine) summary.push(ctxLine.replace("Context Length:", "Context window:"));
    if (priceLine) summary.push(priceLine);
    if (descLine) {
      summary.push(descLine.replace("Description:", "").trim().slice(0, 180));
    }
  } else {
    for (const line of lines) {
      if (summary.length >= 3) break;
      const truncated = line.length > 180 ? `${line.slice(0, 177)}...` : line;
      if (!summary.includes(truncated)) summary.push(truncated);
    }
  }

  if (summary.length === 0) {
    summary.push(`Published on the official ${source.name} channel.`);
  }

  const devImpact = audiences.has("developer")
    ? source.defaultCategory === "coding_tool"
      ? `Review ${source.name} release notes for SDK, CLI, or workflow changes.`
      : "Check model specifications, pricing, or API documentation updates."
    : undefined;

  return {
    importance,
    audiences: Array.from(audiences),
    category,
    headline: candidate.title,
    summary,
    devImpact,
  };
}

function inferVendorFromText(source: SourceConfig, text: string): string {
  const lower = text.toLowerCase();
  if (/\b(openai|chatgpt|gpt-?\d|sora|codex)\b/.test(lower)) return "OpenAI";
  if (/\b(anthropic|claude)\b/.test(lower)) return "Anthropic";
  if (/\b(google|gemini|deepmind|veo|notebooklm)\b/.test(lower)) return "Google";
  if (/\b(xai|grok)\b/.test(lower)) return "xAI";
  if (/\b(meta|llama)\b/.test(lower)) return "Meta";
  if (/\b(deepseek)\b/.test(lower)) return "DeepSeek";
  if (/\b(cursor)\b/.test(lower)) return "Cursor";
  if (/\b(nvidia|cuda|blackwell|rubin)\b/.test(lower)) return "NVIDIA";
  if (/\b(hugging\s*face)\b/.test(lower)) return "Hugging Face";
  if (/\b(mistral)\b/.test(lower)) return "Mistral";
  return source.vendor;
}

export function buildOfficialItem(source: SourceConfig, candidate: RawCandidate): UpdateItem {
  const nowIso = new Date().toISOString();
  const base = classifyByRules(source, candidate);

  return {
    id: candidate.externalId,
    track: "official",
    sourceId: source.id,
    sourceName: source.name,
    vendor: source.vendor,
    title: candidate.title,
    headline: base.headline,
    summary: base.summary,
    importance: base.importance,
    audiences: base.audiences,
    category: base.category,
    devImpact: base.devImpact,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    collectedAt: nowIso,
    evaluatedBy: "rule",
  };
}

export function buildHeuristicRumorItem(source: SourceConfig, candidate: RawCandidate): UpdateItem {
  const nowIso = new Date().toISOString();
  const base = classifyByRules(source, candidate);
  const haystack = `${candidate.title}\n${candidate.rawText}`.toLowerCase();
  const vendor = inferVendorFromText(source, `${candidate.title}\n${candidate.rawText}`);

  let rumorType: RumorType = "insider_report";
  let evidenceBasis: EvidenceBasis = "single_source";
  let credibility: CredibilityLevel = "unverified";
  let credibilityScore = 45;
  let impact = `Potential ${vendor === "Press" || vendor === "Industry" ? "AI ecosystem" : vendor} capability or roadmap shift worth monitoring.`;
  let evidenceSummary = `Reported by ${source.name}; awaiting official vendor confirmation.`;
  let caveat = "No official vendor announcement or primary documentation links were detected.";

  if (source.type === "hf_daily_papers" || source.id === "interconnects") {
    rumorType = "early_research";
    evidenceBasis = "code_or_ui_artifact";
    credibility = "high";
    credibilityScore = 76;
    impact = "Highlights emerging techniques or open-weight trends that often precede product adoption.";
    evidenceSummary = `Published via ${source.name} with technical analysis or research artifacts.`;
    caveat = "Research findings do not guarantee immediate commercial product rollout.";
  } else if (source.type === "hn_algolia" || source.id === "lobsters-ai" || source.id === "simon-willison") {
    rumorType = "community_buzz";
    evidenceBasis = "multiple_reports";
    credibility = "medium";
    credibilityScore = 58;
    impact = "Reflects real-world developer experimentation, tooling shifts, or early bug/feature discoveries.";
    evidenceSummary = `Surfaced in ${source.name} with technical developer commentary.`;
    caveat = "Community observations vary; inspect linked primary artifact before relying on it.";
  } else if (
    source.id === "testingcatalog" ||
    /\b(feature flag|apk|webapp|spotted|hidden|ui|screenshot|code|teardown|unreleased)\b/.test(
      haystack
    )
  ) {
    rumorType = "unreleased_leak";
    evidenceBasis = "code_or_ui_artifact";
    credibility = "medium";
    credibilityScore = 66;
    impact = `Signals upcoming ${vendor} product features or UI changes currently in staged testing.`;
    evidenceSummary = `References observed UI, client code, or staged feature flags prior to release.`;
    caveat = "Staged experiments and feature flags can change or be cancelled before launch.";
  } else if (/\b(reuters|bloomberg|the information|financial times|wsj|exclusive)\b/.test(haystack)) {
    rumorType = "insider_report";
    evidenceBasis = "named_insider";
    credibility = "medium";
    credibilityScore = 62;
    impact = "Points to strategic model, hardware, or commercial moves still under wraps.";
    evidenceSummary = `Cites press reporting or industry insiders; details remain unconfirmed publicly.`;
    caveat = "Timelines, pricing, and final product scope may shift before official release.";
  } else if (/\b(rumor|allegedly|unconfirmed|speculat)\b/.test(haystack)) {
    rumorType = "insider_report";
    evidenceBasis = "speculation";
    credibility = "low";
    credibilityScore = 32;
    evidenceSummary = `Circulating industry claim without attached technical artifacts.`;
    caveat = "Treat as unverified until corroborated by independent sources or vendor confirmation.";
  }

  const rumor: RumorEvaluation = {
    credibility,
    credibilityScore,
    evidenceBasis,
    rumorType,
    claim: candidate.title,
    impact,
    evidenceSummary,
    caveat,
    evaluatedBy: "rule",
  };

  return {
    id: candidate.externalId,
    track: "rumor",
    sourceId: source.id,
    sourceName: source.name,
    vendor,
    title: candidate.title,
    headline: base.headline,
    summary: base.summary.slice(0, 2),
    importance: base.importance,
    audiences: base.audiences,
    category: base.category,
    rumor,
    corroboratingSources: [
      {
        sourceId: source.id,
        sourceName: source.name,
        title: candidate.title,
        url: candidate.url,
        publishedAt: candidate.publishedAt,
      },
    ],
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    collectedAt: nowIso,
    evaluatedBy: "rule",
  };
}

function parseGeminiBatchJson(text: string): GeminiRumorItemResult[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      items?: GeminiRumorItemResult[];
    };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function evaluateRumorBatch(
  entries: Array<{ source: SourceConfig; candidate: RawCandidate }>,
  allowGemini: boolean,
  existingRumors: ExistingRumorContext[] = []
): Promise<{
  items: UpdateItem[];
  merges: RumorMerge[];
  geminiEvaluatedCount: number;
  modelUsed: string | null;
}> {
  if (entries.length === 0) {
    return { items: [], merges: [], geminiEvaluatedCount: 0, modelUsed: null };
  }

  const apiKey = allowGemini ? await getEnvVar("GEMINI_API_KEY") : undefined;
  const model = (await getEnvVar("GEMINI_RUMOR_MODEL")) || DEFAULT_GEMINI_RUMOR_MODEL;

  if (!apiKey) {
    return {
      items: entries.map(({ source, candidate }) => buildHeuristicRumorItem(source, candidate)),
      merges: [],
      geminiEvaluatedCount: 0,
      modelUsed: null,
    };
  }

  const client = new GoogleGenAI({ apiKey });
  const results: UpdateItem[] = [];
  const merges: RumorMerge[] = [];
  const knownContext: ExistingRumorContext[] = [...existingRumors];
  const knownIds = new Set(knownContext.map((r) => r.id));
  let geminiEvaluatedCount = 0;

  for (let i = 0; i < entries.length; i += RUMOR_BATCH_SIZE) {
    const chunk = entries.slice(i, i + RUMOR_BATCH_SIZE);
    const payload = chunk.map(({ source, candidate }) => ({
      id: candidate.externalId,
      source: source.name,
      sourceType: source.type,
      publishedAt: candidate.publishedAt,
      title: candidate.title,
      url: candidate.url,
      excerpt: candidate.rawText.slice(0, 1200),
    }));

    let evaluatedById = new Map<string, GeminiRumorItemResult>();
    try {
      const interaction = await client.interactions.create({
        model,
        system_instruction: RUMOR_SYSTEM_INSTRUCTION,
        input: JSON.stringify(
          {
            recentRumors: knownContext.slice(0, 30),
            candidates: payload,
          },
          null,
          2
        ),
        store: false,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: RUMOR_BATCH_JSON_SCHEMA,
        },
      });

      const parsedItems = interaction.output_text
        ? parseGeminiBatchJson(interaction.output_text)
        : [];
      evaluatedById = new Map(
        parsedItems
          .filter(
            (item): item is GeminiRumorItemResult & { id: string } => typeof item.id === "string"
          )
          .map((item) => [item.id, item])
      );
    } catch (err) {
      console.error("[gemini rumor eval] batch failed, falling back to rules:", err);
    }

    for (const { source, candidate } of chunk) {
      const fallbackItem = buildHeuristicRumorItem(source, candidate);
      const gem = evaluatedById.get(candidate.externalId);

      if (!gem) {
        results.push(fallbackItem);
        knownIds.add(fallbackItem.id);
        knownContext.unshift({
          id: fallbackItem.id,
          vendor: fallbackItem.vendor,
          headline: fallbackItem.headline,
          claim: fallbackItem.rumor?.claim ?? fallbackItem.headline,
          sourceName: fallbackItem.sourceName,
        });
        continue;
      }

      if (gem.is_relevant === false) {
        continue;
      }

      const fallbackRumor = fallbackItem.rumor!;
      const summary =
        Array.isArray(gem.summary) && gem.summary.length > 0
          ? gem.summary.map((s) => compactWhitespace(String(s))).filter(Boolean).slice(0, 3)
          : fallbackItem.summary;

      const rumor: RumorEvaluation = {
        credibility: normalizeCredibility(gem.credibility, fallbackRumor.credibility),
        credibilityScore: clampScore(gem.credibilityScore, fallbackRumor.credibilityScore),
        evidenceBasis: normalizeEvidenceBasis(gem.evidenceBasis, fallbackRumor.evidenceBasis),
        rumorType: normalizeRumorType(gem.rumorType, fallbackRumor.rumorType),
        claim: compactWhitespace(gem.claim || "") || fallbackRumor.claim,
        impact: compactWhitespace(gem.impact || "") || fallbackRumor.impact,
        evidenceSummary:
          compactWhitespace(gem.evidenceSummary || "") || fallbackRumor.evidenceSummary,
        caveat: compactWhitespace(gem.caveat || "") || fallbackRumor.caveat,
        evaluatedBy: "gemini",
        model,
      };

      const dupTarget = compactWhitespace(gem.duplicateOfId || "");
      if (dupTarget && dupTarget !== candidate.externalId && knownIds.has(dupTarget)) {
        merges.push({
          targetId: dupTarget,
          source: {
            sourceId: source.id,
            sourceName: source.name,
            title: candidate.title,
            url: candidate.url,
            publishedAt: candidate.publishedAt,
          },
          updatedRumor: {
            ...rumor,
            evidenceBasis: "multiple_reports",
          },
          updatedSummary: summary,
        });
        geminiEvaluatedCount++;
        continue;
      }

      const createdItem: UpdateItem = {
        ...fallbackItem,
        vendor: compactWhitespace(gem.vendor || "") || fallbackItem.vendor,
        headline: compactWhitespace(gem.headline || "") || fallbackItem.headline,
        summary,
        importance: normalizeImportance(gem.importance, fallbackItem.importance),
        audiences: normalizeAudiences(gem.audiences, fallbackItem.audiences),
        category: normalizeCategory(gem.category, fallbackItem.category),
        rumor,
        evaluatedBy: "gemini",
      };

      results.push(createdItem);
      knownIds.add(createdItem.id);
      knownContext.unshift({
        id: createdItem.id,
        vendor: createdItem.vendor,
        headline: createdItem.headline,
        claim: rumor.claim,
        sourceName: createdItem.sourceName,
      });
      geminiEvaluatedCount++;
    }
  }

  return {
    items: results,
    merges,
    geminiEvaluatedCount,
    modelUsed: geminiEvaluatedCount > 0 ? model : null,
  };
}
