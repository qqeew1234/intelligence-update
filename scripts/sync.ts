import { getRumorEvaluatorInfo } from "../src/lib/summarizer";
import { runSync } from "../src/lib/sync";

async function main() {
  const evaluator = await getRumorEvaluatorInfo();
  console.log(
    `[Intelligence Update] Starting sync (Rumor eval mode: ${evaluator.mode}, model: ${evaluator.model})`
  );

  const result = await runSync({
    useGemini: evaluator.mode === "gemini",
  });

  console.log("\nSource Sync Report:");
  console.table(
    result.reports.map((r) => ({
      Track: r.track,
      Source: r.sourceName,
      Vendor: r.vendor,
      Type: r.type,
      Status: r.status === "ok" ? "OK" : `ERR (${r.error ?? "unknown"})`,
      Fetched: r.fetchedCount,
      New: r.newCount,
    }))
  );

  console.log(
    `Completed (${result.syncedAt}) — ${result.totalFetched} items checked, ${result.totalNew} new items saved (Gemini rumors evaluated: ${result.rumorsEvaluatedCount}${result.rumorModel ? ` via ${result.rumorModel}` : ""})`
  );
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
