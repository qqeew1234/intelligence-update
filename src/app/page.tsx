import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { APP_BUILD_ID } from "@/lib/build-info";
import { getSourcesByDomain } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
