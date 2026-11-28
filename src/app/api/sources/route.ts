import { NextRequest, NextResponse } from "next/server";
import { getSourcesByDomain } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import type { Domain } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawDomain = request.nextUrl.searchParams.get("domain");
  const domain: Domain =
    rawDomain === "hardware" || rawDomain === "compute" ? "hardware" : "ai";
  const store = await readStore(domain);
  const logMap = new Map(store.syncLogs.map((log) => [log.sourceId, log]));
  const domainSources = getSourcesByDomain(domain);

  const sources = domainSources.map((source) => ({
    ...source,
    snapshot: store.snapshots[source.id] ?? null,
    lastReport: logMap.get(source.id) ?? null,
  }));

  return NextResponse.json({
    domain,
    lastSyncedAt: store.lastSyncedAt,
    sources,
  });
}
