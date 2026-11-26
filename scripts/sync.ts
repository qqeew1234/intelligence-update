import { getActiveLlmProvider } from "../src/lib/summarizer";
import { runSync } from "../src/lib/sync";

async function main() {
  const provider = await getActiveLlmProvider();
  console.log(`[지능 업데이트] 동기화 시작 (요약 모드: ${provider})`);

  const result = await runSync({
    limitPerSource: 5,
    maxLlmItems: 15,
    useLlm: provider !== "rule",
  });

  console.log("\n소스별 수집 결과:");
  console.table(
    result.reports.map((r) => ({
      소스: r.sourceName,
      벤더: r.vendor,
      유형: r.type,
      상태: r.status === "ok" ? "OK" : `ERR (${r.error ?? "unknown"})`,
      전체수: r.fetchedCount,
      신규: r.newCount,
    }))
  );

  console.log(
    `완료 (${result.syncedAt}) — 총 ${result.totalFetched}건 확인, 신규 ${result.totalNew}건 저장 (AI 요약: ${result.llmSummarizedCount}건)`
  );
}

main().catch((err) => {
  console.error("동기화 실행 중 오류:", err);
  process.exit(1);
});
