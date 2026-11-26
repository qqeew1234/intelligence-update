import { collectFromSource } from "./collectors";
import { SOURCES } from "./sources";
import { readStore, writeStore } from "./storage";
import { summarizeCandidate } from "./summarizer";
import type { SyncResult, SyncSourceReport, UpdateItem } from "./types";

export interface RunSyncOptions {
  limitPerSource?: number;
  maxLlmItems?: number;
  useLlm?: boolean;
}

export async function runSync(options: RunSyncOptions = {}): Promise<SyncResult> {
  const { limitPerSource = 5, maxLlmItems = 15, useLlm = true } = options;
  const store = await readStore();
  const syncedAt = new Date().toISOString();

  const existingById = new Map<string, UpdateItem>(store.updates.map((u) => [u.id, u]));
  const enabledSources = SOURCES.filter((s) => s.enabled);

  const settled = await Promise.allSettled(
    enabledSources.map(async (source) => {
      const output = await collectFromSource(source, store.snapshots[source.id], limitPerSource);
      return { source, output };
    })
  );

  const reports: SyncSourceReport[] = [];
  const newCandidates: Array<{
    source: (typeof enabledSources)[number];
    candidate: Awaited<ReturnType<typeof collectFromSource>>["candidates"][number];
  }> = [];

  for (let i = 0; i < enabledSources.length; i++) {
    const source = enabledSources[i];
    const result = settled[i];

    if (result.status === "fulfilled") {
      const { output } = result.value;
      store.snapshots[source.id] = output.nextSnapshot;

      let sourceNewCount = 0;
      for (const candidate of output.candidates) {
        if (!existingById.has(candidate.externalId)) {
          newCandidates.push({ source, candidate });
          sourceNewCount++;
        }
      }

      reports.push({
        sourceId: source.id,
        sourceName: source.name,
        vendor: source.vendor,
        type: source.type,
        status: "ok",
        fetchedCount: output.fetchedCount,
        newCount: sourceNewCount,
      });
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
      reports.push({
        sourceId: source.id,
        sourceName: source.name,
        vendor: source.vendor,
        type: source.type,
        status: "error",
        fetchedCount: 0,
        newCount: 0,
        error: errorMessage,
      });
    }
  }

  // Sort newest candidates first so LLM quota focuses on the freshest updates.
  newCandidates.sort(
    (a, b) =>
      new Date(b.candidate.publishedAt).getTime() - new Date(a.candidate.publishedAt).getTime()
  );

  let llmCalls = 0;
  let totalNew = 0;

  for (const { source, candidate } of newCandidates) {
    const allowLlm = useLlm && llmCalls < maxLlmItems;
    const { item, usedLlm } = await summarizeCandidate(source, candidate, allowLlm);
    if (usedLlm) llmCalls++;
    if (item) {
      existingById.set(item.id, item);
      totalNew++;
    }
  }

  const mergedUpdates = Array.from(existingById.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 200);

  store.lastSyncedAt = syncedAt;
  store.updates = mergedUpdates;
  store.syncLogs = reports;

  await writeStore(store);

  const totalFetched = reports.reduce((acc, r) => acc + r.fetchedCount, 0);
  return {
    syncedAt,
    totalFetched,
    totalNew,
    llmSummarizedCount: llmCalls,
    reports,
  };
}
