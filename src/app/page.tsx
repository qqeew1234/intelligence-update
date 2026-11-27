import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { SOURCES } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [store, evaluator] = await Promise.all([readStore(), getRumorEvaluatorInfo()]);

  return (
    <UpdateFeedClient
      initialUpdates={store.updates}
      initialLastSyncedAt={store.lastSyncedAt}
      initialSyncLogs={store.syncLogs}
      sources={SOURCES}
      evaluator={evaluator}
    />
  );
}
