import { collectFromSource } from "./collectors";
import { SOURCES } from "./sources";
import { readStore, writeStore } from "./storage";
import {
  buildOfficialItem,
  evaluateRumorBatch,
  getRumorEvaluatorInfo,
} from "./summarizer";
import type {
  RawCandidate,
  SourceConfig,
  SyncResult,
  SyncSourceReport,
  Track,
  UpdateItem,
} from "./types";

export interface RunSyncOptions {
  track?: Track | "all";
  limitPerSource?: number;
  officialLimit?: number;
  rumorLimit?: number;
  maxGeminiRumors?: number;
  useGemini?: boolean;
}

const MAX_OFFICIAL_ITEMS = 150;
const MAX_RUMOR_ITEMS = 100;
const MAX_UPGRADE_RUMORS_PER_SYNC = 6;

export async function runSync(options: RunSyncOptions = {}): Promise<SyncResult> {
  const {
    track = "all",
    limitPerSource,
    officialLimit = 5,
    rumorLimit = 3,
    maxGeminiRumors = 18,
    useGemini = true,
  } = options;

  const store = await readStore();
  const syncedAt = new Date().toISOString();

  const existingById = new Map<string, UpdateItem>(store.updates.map((u) => [u.id, u]));
  const targetSources = SOURCES.filter(
    (s) => s.enabled && (track === "all" || s.track === track)
  );

  const settled = await Promise.allSettled(
    targetSources.map(async (source) => {
      const perSourceLimit =
        limitPerSource ?? (source.track === "official" ? officialLimit : rumorLimit);
      const output = await collectFromSource(source, store.snapshots[source.id], perSourceLimit);
      return { source, output };
    })
  );

  const reportBySourceId = new Map<string, SyncSourceReport>(
    store.syncLogs.map((log) => [log.sourceId, log])
  );
  const newOfficial: Array<{ source: SourceConfig; candidate: RawCandidate }> = [];
  const newRumors: Array<{ source: SourceConfig; candidate: RawCandidate }> = [];
  const currentReports: SyncSourceReport[] = [];

  for (let i = 0; i < targetSources.length; i++) {
    const source = targetSources[i];
    const result = settled[i];

    if (result.status === "fulfilled") {
      const { output } = result.value;
      store.snapshots[source.id] = output.nextSnapshot;

      let sourceNewCount = 0;
      for (const candidate of output.candidates) {
        if (!existingById.has(candidate.externalId)) {
          if (source.track === "official") {
            newOfficial.push({ source, candidate });
          } else {
            newRumors.push({ source, candidate });
          }
          sourceNewCount++;
        }
      }

      const report: SyncSourceReport = {
        sourceId: source.id,
        sourceName: source.name,
        vendor: source.vendor,
        type: source.type,
        track: source.track,
        status: "ok",
        fetchedCount: output.fetchedCount,
        newCount: sourceNewCount,
      };
      reportBySourceId.set(source.id, report);
      currentReports.push(report);
    } else {
      const errorMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      const prev = store.snapshots[source.id];
      store.snapshots[source.id] = {
        sourceId: source.id,
        lastCheckedAt: syncedAt,
        lastSuccessAt: prev?.lastSuccessAt,
        lastHash: prev?.lastHash,
        seenIds: prev?.seenIds ?? [],
        lastError: errorMessage,
      };
      const report: SyncSourceReport = {
        sourceId: source.id,
        sourceName: source.name,
        vendor: source.vendor,
        type: source.type,
        track: source.track,
        status: "error",
        fetchedCount: 0,
        newCount: 0,
        error: errorMessage,
      };
      reportBySourceId.set(source.id, report);
      currentReports.push(report);
    }
  }

  let totalNew = 0;

  for (const { source, candidate } of newOfficial) {
    const item = buildOfficialItem(source, candidate);
    existingById.set(item.id, item);
    totalNew++;
  }

  // Sort newest rumors first so Gemini quota prioritizes the freshest signals.
  newRumors.sort(
    (a, b) =>
      new Date(b.candidate.publishedAt).getTime() - new Date(a.candidate.publishedAt).getTime()
  );

  const evaluatorInfo = await getRumorEvaluatorInfo();
  const canUseGemini = useGemini && evaluatorInfo.mode === "gemini";

  const geminiBudgetItems = newRumors.slice(0, maxGeminiRumors);
  const overflowRumorItems = newRumors.slice(maxGeminiRumors);

  const primaryEval = await evaluateRumorBatch(geminiBudgetItems, canUseGemini);
  const overflowEval = await evaluateRumorBatch(overflowRumorItems, false);

  for (const item of [...primaryEval.items, ...overflowEval.items]) {
    existingById.set(item.id, item);
    totalNew++;
  }

  let rumorsEvaluatedCount = primaryEval.geminiEvaluatedCount;
  let rumorModel = primaryEval.modelUsed;

  // If Gemini is enabled and budget remains, upgrade up to 6 older rule-evaluated rumors.
  const remainingBudget = Math.max(0, maxGeminiRumors - geminiBudgetItems.length);
  if (canUseGemini && remainingBudget > 0 && (track === "all" || track === "rumor")) {
    const sourceMap = new Map(SOURCES.map((s) => [s.id, s]));
    const upgradeLimit = Math.min(MAX_UPGRADE_RUMORS_PER_SYNC, remainingBudget);
    const toUpgrade = Array.from(existingById.values())
      .filter((u) => u.track === "rumor" && u.evaluatedBy === "rule")
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, upgradeLimit);

    if (toUpgrade.length > 0) {
      const upgradeEntries: Array<{ source: SourceConfig; candidate: RawCandidate }> = [];
      for (const item of toUpgrade) {
        const src = sourceMap.get(item.sourceId);
        if (!src) continue;
        upgradeEntries.push({
          source: src,
          candidate: {
            externalId: item.id,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            rawText: [item.headline, ...item.summary, item.rumor?.evidenceSummary ?? ""]
              .filter(Boolean)
              .join("\n"),
            contentHash: item.id,
          },
        });
      }

      if (upgradeEntries.length > 0) {
        const upgraded = await evaluateRumorBatch(upgradeEntries, true);
        for (const item of upgraded.items) {
          existingById.set(item.id, item);
        }
        rumorsEvaluatedCount += upgraded.geminiEvaluatedCount;
        rumorModel = rumorModel ?? upgraded.modelUsed;
      }
    }
  }

  const allItems = Array.from(existingById.values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const officialUpdates = allItems
    .filter((u) => u.track === "official")
    .slice(0, MAX_OFFICIAL_ITEMS);
  const rumorUpdates = allItems.filter((u) => u.track === "rumor").slice(0, MAX_RUMOR_ITEMS);

  store.lastSyncedAt = syncedAt;
  store.updates = [...officialUpdates, ...rumorUpdates].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  store.syncLogs = SOURCES.map((s) => reportBySourceId.get(s.id)).filter(
    (r): r is SyncSourceReport => Boolean(r)
  );

  await writeStore(store);

  const totalFetched = currentReports.reduce((acc, r) => acc + r.fetchedCount, 0);
  return {
    syncedAt,
    totalFetched,
    totalNew,
    rumorsEvaluatedCount,
    rumorModel,
    reports: currentReports,
  };
}
