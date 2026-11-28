import type { Metadata } from "next";
import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { APP_BUILD_ID } from "@/lib/build-info";
import { getSourcesByDomain } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const metadata: Metadata = {
  title: "AI Intel — Official AI Releases & Signals",
  description:
    "Signal-first tracker for official AI releases, SDK updates, and Gemini-evaluated industry signals.",
};

export const dynamic = "force-dynamic";

export default async function AiPage() {
  const [store, evaluator] = await Promise.all([readStore("ai"), getRumorEvaluatorInfo()]);

  return (
    <UpdateFeedClient
      key="ai"
      domain="ai"
      initialUpdates={store.updates}
      initialLastSyncedAt={store.lastSyncedAt}
      initialSyncLogs={store.syncLogs}
      sources={getSourcesByDomain("ai")}
      evaluator={evaluator}
      initialBuildId={APP_BUILD_ID}
    />
  );
}
