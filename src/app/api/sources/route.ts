import { NextResponse } from "next/server";
import { SOURCES } from "@/lib/sources";
import { readStore } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await readStore();
  const logMap = new Map(store.syncLogs.map((log) => [log.sourceId, log]));

  const sources = SOURCES.map((source) => ({
    ...source,
    snapshot: store.snapshots[source.id] ?? null,
    lastReport: logMap.get(source.id) ?? null,
  }));

  return NextResponse.json({
    lastSyncedAt: store.lastSyncedAt,
    sources,
  });
}
