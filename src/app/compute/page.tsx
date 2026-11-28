import type { Metadata } from "next";
import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { APP_BUILD_ID } from "@/lib/build-info";
import { getSourcesByDomain } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const metadata: Metadata = {
  title: "Compute Intel — Official AI Silicon, GPU & Infrastructure Releases & Signals",
  description:
    "Official GPU, AI silicon, Apple Silicon, local LLM compute runtimes and Gemini-evaluated compute signals.",
};

export const dynamic = "force-dynamic";

export default async function ComputePage() {
  const [store, evaluator] = await Promise.all([
    readStore("hardware"),
    getRumorEvaluatorInfo(),
  ]);

  return (
    <UpdateFeedClient
      key="compute"
      domain="hardware"
      initialUpdates={store.updates}
      initialLastSyncedAt={store.lastSyncedAt}
      initialSyncLogs={store.syncLogs}
      sources={getSourcesByDomain("hardware")}
      evaluator={evaluator}
      initialBuildId={APP_BUILD_ID}
    />
  );
}
