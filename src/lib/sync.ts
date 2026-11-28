import { collectFromSource } from "./collectors";
import { getSourcesByDomain } from "./sources";
import { readStore, writeStore } from "./storage";
import {
  buildOfficialItem,
  evaluateRumorBatch,
  getRumorEvaluatorInfo,
  type ExistingRumorContext,
} from "./summarizer";
import { canonicalizeUrl } from "./text";
import type {
  CorroboratingSource,
  Domain,
  RawCandidate,
  RumorEvaluation,
  SourceConfig,
  SyncResult,
  SyncSourceReport,
  Track,
  UpdateItem,
} from "./types";

export interface RunSyncOptions {
  domain?: Domain;
  track?: Track | "all";
  limitPerSource?: number;
  officialLimit?: number;
  rumorLimit?: number;
  maxGeminiRumors?: number;
  useGemini?: boolean;
}

const MAX_OFFICIAL_ITEMS = 150;
const MAX_RUMOR_ITEMS = 100;
const MAX_UPGRADE_RUMORS_PER_SYNC = 12;
const RECENT_RUMOR_WINDOW_MS = 72 * 60 * 60 * 1000;

function ensureCorroboratingSources(item: UpdateItem): CorroboratingSource[] {
  if (Array.isArray(item.corroboratingSources) && item.corroboratingSources.length > 0) {
    return item.corroboratingSources;
  }
  return [
    {
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
    },
  ];
}

function mergeCorroboratingSource(
  target: UpdateItem,
  incoming: CorroboratingSource,
  updatedRumor?: Partial<RumorEvaluation>,
  updatedSummary?: string[]
): boolean {
  const existing = ensureCorroboratingSources(target);
  const incomingKey = `${incoming.sourceId}::${canonicalizeUrl(incoming.url)}`;
  const alreadyHas = existing.some(
    (s) => `${s.sourceId}::${canonicalizeUrl(s.url)}` === incomingKey
  );

  const nextSources = alreadyHas ? existing : [...existing, incoming].slice(0, 10);
  target.corroboratingSources = nextSources;

  if (target.rumor) {
    const mergedRumor: RumorEvaluation = {
      ...target.rumor,
      ...updatedRumor,
    };
    if (nextSources.length >= 2) {
      mergedRumor.evidenceBasis = "multiple_reports";
    }
    target.rumor = mergedRumor;
    target.evaluatedBy = mergedRumor.evaluatedBy;
  }

  if (updatedSummary && updatedSummary.length > 0) {
    target.summary = updatedSummary;
  }

  return !alreadyHas;
}

function buildRecentRumorContext(
  items: Iterable<UpdateItem>,
  excludeIds = new Set<string>()
): ExistingRumorContext[] {
  const cutoff = Date.now() - RECENT_RUMOR_WINDOW_MS;
  return Array.from(items)
    .filter(
      (u) =>
        u.track === "rumor" &&
        !excludeIds.has(u.id) &&
        new Date(u.publishedAt).getTime() >= cutoff
    )
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 30)
    .map((u) => ({
      id: u.id,
      vendor: u.vendor,
      headline: u.headline,
      claim: u.rumor?.claim ?? u.headline,
      sourceName: u.sourceName,
    }));
}

export async function runSync(options: RunSyncOptions = {}): Promise<SyncResult> {
  const {
    domain = "ai",
    track = "all",
    limitPerSource,
    officialLimit = 5,
    rumorLimit = 2,
    maxGeminiRumors = 24,
    useGemini = true,
  } = options;

  const store = await readStore(domain);
  const syncedAt = new Date().toISOString();
  const domainSources = getSourcesByDomain(domain);

  const existingById = new Map<string, UpdateItem>(store.updates.map((u) => [u.id, u]));
  const existingRumorByUrl = new Map<string, UpdateItem>();
  for (const item of store.updates) {
    if (item.track !== "rumor") continue;
    for (const src of ensureCorroboratingSources(item)) {
      const key = canonicalizeUrl(src.url);
      if (key && !existingRumorByUrl.has(key)) {
        existingRumorByUrl.set(key, item);
      }
    }
    const primaryKey = canonicalizeUrl(item.url);
    if (primaryKey && !existingRumorByUrl.has(primaryKey)) {
      existingRumorByUrl.set(primaryKey, item);
    }
  }

  const targetSources = domainSources.filter(
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
  const queuedRumorByUrl = new Map<string, { source: SourceConfig; candidate: RawCandidate }>();
  const pendingUrlMerges: Array<{ targetId: string; source: CorroboratingSource }> = [];
  const currentReports: SyncSourceReport[] = [];
  let mergedDuplicatesCount = 0;

  for (let i = 0; i < targetSources.length; i++) {
    const source = targetSources[i];
    const result = settled[i];

    if (result.status === "fulfilled") {
      const { output } = result.value;
      store.snapshots[source.id] = output.nextSnapshot;

      let sourceNewCount = 0;
      for (const candidate of output.candidates) {
        if (existingById.has(candidate.externalId)) continue;

        if (source.track === "official") {
          newOfficial.push({ source, candidate });
          sourceNewCount++;
          continue;
        }

        // Stage 1: Canonical URL deduplication against stored rumors and current batch
        const canonical = canonicalizeUrl(candidate.url);
        const existingTarget = canonical ? existingRumorByUrl.get(canonical) : undefined;
        if (existingTarget) {
          const added = mergeCorroboratingSource(existingTarget, {
            sourceId: source.id,
            sourceName: source.name,
            title: candidate.title,
            url: candidate.url,
            publishedAt: candidate.publishedAt,
          });
          if (added) mergedDuplicatesCount++;
          continue;
        }

        const queuedTarget = canonical ? queuedRumorByUrl.get(canonical) : undefined;
        if (queuedTarget) {
          pendingUrlMerges.push({
            targetId: queuedTarget.candidate.externalId,
            source: {
              sourceId: source.id,
              sourceName: source.name,
              title: candidate.title,
              url: candidate.url,
              publishedAt: candidate.publishedAt,
            },
          });
          mergedDuplicatesCount++;
          continue;
        }

        if (canonical) {
          queuedRumorByUrl.set(canonical, { source, candidate });
        }
        newRumors.push({ source, candidate });
        sourceNewCount++;
      }

      const report: SyncSourceReport = {
        sourceId: source.id,
        sourceName: source.name,
        vendor: source.vendor,
        type: source.type,
        domain,
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
        domain,
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
  const recentRumorsContext = buildRecentRumorContext(existingById.values());

  // Stage 2: Gemini synthesis + semantic cross-source clustering
  const primaryEval = await evaluateRumorBatch(
    geminiBudgetItems,
    canUseGemini,
    recentRumorsContext,
    domain
  );
  const overflowEval = await evaluateRumorBatch(overflowRumorItems, false, [], domain);

  for (const item of [...primaryEval.items, ...overflowEval.items]) {
    existingById.set(item.id, item);
    totalNew++;
  }

  for (const merge of pendingUrlMerges) {
    const target = existingById.get(merge.targetId);
    if (target) {
      mergeCorroboratingSource(target, merge.source);
    }
  }

  for (const merge of primaryEval.merges) {
    const target = existingById.get(merge.targetId);
    if (target) {
      const added = mergeCorroboratingSource(
        target,
        merge.source,
        merge.updatedRumor,
        merge.updatedSummary
      );
      if (added) mergedDuplicatesCount++;
    }
  }

  let rumorsEvaluatedCount = primaryEval.geminiEvaluatedCount;
  let rumorModel = primaryEval.modelUsed;

  // If Gemini is enabled and budget remains, upgrade up to 12 older rule-evaluated rumors.
  const remainingBudget = Math.max(0, maxGeminiRumors - geminiBudgetItems.length);
  if (canUseGemini && remainingBudget > 0 && (track === "all" || track === "rumor")) {
    const sourceMap = new Map(domainSources.map((s) => [s.id, s]));
    const upgradeLimit = Math.min(MAX_UPGRADE_RUMORS_PER_SYNC, remainingBudget);
    const toUpgrade = Array.from(existingById.values())
      .filter((u) => u.track === "rumor" && u.evaluatedBy === "rule")
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, upgradeLimit);

    if (toUpgrade.length > 0) {
      const upgradeIds = new Set(toUpgrade.map((u) => u.id));
      const upgradeEntries: Array<{ source: SourceConfig; candidate: RawCandidate }> = [];
      const priorById = new Map<string, UpdateItem>();

      for (const item of toUpgrade) {
        const src = sourceMap.get(item.sourceId);
        if (!src) continue;
        priorById.set(item.id, item);
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
        const contextExcludingUpgrades = buildRecentRumorContext(
          existingById.values(),
          upgradeIds
        );
        const upgraded = await evaluateRumorBatch(
          upgradeEntries,
          true,
          contextExcludingUpgrades,
          domain
        );

        for (const item of upgraded.items) {
          const prior = priorById.get(item.id);
          if (prior?.corroboratingSources && prior.corroboratingSources.length > 1) {
            item.corroboratingSources = prior.corroboratingSources;
            if (item.rumor) {
              item.rumor.evidenceBasis = "multiple_reports";
            }
          }
          existingById.set(item.id, item);
        }

        for (const merge of upgraded.merges) {
          const target = existingById.get(merge.targetId);
          if (target) {
            mergeCorroboratingSource(
              target,
              merge.source,
              merge.updatedRumor,
              merge.updatedSummary
            );
            existingById.delete(
              upgradeEntries.find((e) => e.candidate.url === merge.source.url)?.candidate
                .externalId ?? ""
            );
            mergedDuplicatesCount++;
          }
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
  store.syncLogs = domainSources.map((s) => reportBySourceId.get(s.id)).filter(
    (r): r is SyncSourceReport => Boolean(r)
  );

  await writeStore(store, domain);

  const totalFetched = currentReports.reduce((acc, r) => acc + r.fetchedCount, 0);
  return {
    syncedAt,
    totalFetched,
    totalNew,
    rumorsEvaluatedCount,
    mergedDuplicatesCount,
    rumorModel,
    reports: currentReports,
  };
}
