import { getRumorEvaluatorInfo } from "../src/lib/summarizer";
import { runSync } from "../src/lib/sync";
import type { Domain } from "../src/lib/types";

function parseDomainArg(): Domain | "all" {
  const arg = process.argv.find((a) => a.startsWith("--domain="));
  const value = arg?.split("=")[1];
  if (value === "hardware" || value === "all" || value === "ai") return value;
  return "ai";
}

async function main() {
  const target = parseDomainArg();
  const domains: Domain[] = target === "all" ? ["ai", "hardware"] : [target];
  const evaluator = await getRumorEvaluatorInfo();

  for (const domain of domains) {
    console.log(
      `[Intelligence Update:${domain}] Starting sync (Rumor eval mode: ${evaluator.mode}, model: ${evaluator.model})`
    );

    const result = await runSync({
      domain,
      useGemini: evaluator.mode === "gemini",
    });

    console.log(`\nSource Sync Report (${domain}):`);
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
      `Completed ${domain} (${result.syncedAt}) — ${result.totalFetched} items checked, ${result.totalNew} new items saved (Gemini rumors evaluated: ${result.rumorsEvaluatedCount}${result.rumorModel ? ` via ${result.rumorModel}` : ""})`
    );
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
