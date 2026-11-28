import type { Metadata } from "next";
import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { APP_BUILD_ID } from "@/lib/build-info";
import { getSourcesByDomain } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const metadata: Metadata = {
  title: "Hardware Intel — Official AI Silicon Releases & Signals",
  description:
    "Official AI silicon, GPU, Apple Silicon, local LLM hardware releases and Gemini-evaluated hardware signals.",
};

export const dynamic = "force-dynamic";

export default async function HardwarePage() {
  const [store, evaluator] = await Promise.all([
    readStore("hardware"),
    getRumorEvaluatorInfo(),
  ]);

  return (
    <UpdateFeedClient
      key="hardware"
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
