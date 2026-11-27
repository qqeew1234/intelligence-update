export type Track = "official" | "rumor";

export type Importance = "major" | "minor" | "patch";

export type Audience = "developer" | "general";

export type Category =
  | "new_model"
  | "new_feature"
  | "pricing"
  | "deprecation"
  | "coding_tool"
  | "bugfix"
  | "research";

export type SourceType =
  | "rss"
  | "atom"
  | "openrouter_models"
  | "html_changelog"
  | "hn_algolia"
  | "hf_daily_papers";

export type RumorType =
  | "unreleased_leak"
  | "insider_report"
  | "community_buzz"
  | "early_research";

export type CredibilityLevel = "high" | "medium" | "low" | "unverified";

export type EvidenceBasis =
  | "code_or_ui_artifact"
  | "multiple_reports"
  | "named_insider"
  | "single_source"
  | "speculation";

export interface RumorEvaluation {
  credibility: CredibilityLevel;
  credibilityScore: number;
  evidenceBasis: EvidenceBasis;
  rumorType: RumorType;
  claim: string;
  evidenceSummary: string;
  caveat: string;
  evaluatedBy: "gemini" | "rule";
  model?: string;
}

export interface SourceConfig {
  id: string;
  name: string;
  vendor: string;
  url: string;
  type: SourceType;
  track: Track;
  defaultAudiences: Audience[];
  defaultCategory: Category;
  enabled: boolean;
}

export interface RawCandidate {
  externalId: string;
  title: string;
  url: string;
  publishedAt: string;
  rawText: string;
  contentHash: string;
}

export interface UpdateItem {
  id: string;
  track: Track;
  sourceId: string;
  sourceName: string;
  vendor: string;
  title: string;
  headline: string;
  summary: string[];
  importance: Importance;
  audiences: Audience[];
  category: Category;
  devImpact?: string;
  rumor?: RumorEvaluation;
  url: string;
  publishedAt: string;
  collectedAt: string;
  evaluatedBy: "gemini" | "rule";
}

export interface SourceSnapshot {
  sourceId: string;
  lastCheckedAt: string;
  lastSuccessAt?: string;
  lastHash?: string;
  seenIds: string[];
  lastError?: string;
}

export interface SyncSourceReport {
  sourceId: string;
  sourceName: string;
  vendor: string;
  type: SourceType;
  track: Track;
  status: "ok" | "error";
  fetchedCount: number;
  newCount: number;
  error?: string;
}

export interface SyncResult {
  syncedAt: string;
  totalFetched: number;
  totalNew: number;
  rumorsEvaluatedCount: number;
  rumorModel: string | null;
  reports: SyncSourceReport[];
}

export interface StoreData {
  lastSyncedAt: string | null;
  updates: UpdateItem[];
  snapshots: Record<string, SourceSnapshot>;
  syncLogs: SyncSourceReport[];
}
