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
  | "html_changelog";

export interface SourceConfig {
  id: string;
  name: string;
  vendor: string;
  url: string;
  type: SourceType;
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
  sourceId: string;
  sourceName: string;
  vendor: string;
  title: string;
  titleKo: string;
  summaryKo: string[];
  importance: Importance;
  audiences: Audience[];
  category: Category;
  devImpact?: string;
  url: string;
  publishedAt: string;
  collectedAt: string;
  summarizedBy: "gemini" | "openai" | "rule";
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
  status: "ok" | "error";
  fetchedCount: number;
  newCount: number;
  error?: string;
}

export interface SyncResult {
  syncedAt: string;
  totalFetched: number;
  totalNew: number;
  llmSummarizedCount: number;
  reports: SyncSourceReport[];
}

export interface StoreData {
  lastSyncedAt: string | null;
  updates: UpdateItem[];
  snapshots: Record<string, SourceSnapshot>;
  syncLogs: SyncSourceReport[];
}
