import { NextRequest, NextResponse } from "next/server";
import { SOURCES } from "@/lib/sources";
import { readStore } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const audience = searchParams.get("audience");
  const importance = searchParams.get("importance");
  const vendor = searchParams.get("vendor");
  const sourceId = searchParams.get("sourceId");
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";

  const store = await readStore();
  let filtered = store.updates;

  if (audience === "developer" || audience === "general") {
    filtered = filtered.filter((item) => item.audiences.includes(audience));
  }
  if (importance === "major" || importance === "minor" || importance === "patch") {
    filtered = filtered.filter((item) => item.importance === importance);
  }
  if (vendor && vendor !== "all") {
    filtered = filtered.filter((item) => item.vendor === vendor);
  }
  if (sourceId) {
    filtered = filtered.filter((item) => item.sourceId === sourceId);
  }
  if (q) {
    filtered = filtered.filter((item) => {
      const text = [
        item.title,
        item.titleKo,
        item.vendor,
        item.sourceName,
        ...item.summaryKo,
        item.devImpact ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }

  const vendors = Array.from(new Set(SOURCES.map((s) => s.vendor)));

  return NextResponse.json({
    updates: filtered,
    lastSyncedAt: store.lastSyncedAt,
    syncLogs: store.syncLogs,
    total: filtered.length,
    vendors,
    sources: SOURCES,
  });
}
