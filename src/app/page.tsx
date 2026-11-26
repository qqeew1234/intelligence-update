import { UpdateFeedClient } from "@/components/UpdateFeedClient";
import { SOURCES } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getActiveLlmProvider } from "@/lib/summarizer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const store = await readStore();
  const llmProvider = await getActiveLlmProvider();

  return (
    <UpdateFeedClient
      initialUpdates={store.updates}
      initialLastSyncedAt={store.lastSyncedAt}
      initialSyncLogs={store.syncLogs}
      sources={SOURCES}
      llmProvider={llmProvider}
    />
  );
}
