import { NextRequest, NextResponse } from "next/server";
import { APP_BUILD_ID } from "@/lib/build-info";
import { SOURCES } from "@/lib/sources";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const track = searchParams.get("track");
  const audience = searchParams.get("audience");
  const importance = searchParams.get("importance");
  const credibility = searchParams.get("credibility");
  const vendor = searchParams.get("vendor");
  const sourceId = searchParams.get("sourceId");
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";

  const [store, evaluator] = await Promise.all([readStore(), getRumorEvaluatorInfo()]);
  let filtered = store.updates;

  if (track === "official" || track === "rumor") {
    filtered = filtered.filter((item) => item.track === track);
  }
  if (audience === "developer" || audience === "general") {
    filtered = filtered.filter((item) => item.audiences.includes(audience));
  }
  if (importance === "major" || importance === "minor" || importance === "patch") {
    filtered = filtered.filter((item) => item.importance === importance);
  }
  if (
    credibility === "high" ||
    credibility === "medium" ||
    credibility === "low" ||
    credibility === "unverified"
  ) {
    filtered = filtered.filter((item) => item.rumor?.credibility === credibility);
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
        item.headline,
        item.vendor,
        item.sourceName,
        ...item.summary,
        item.devImpact ?? "",
        item.rumor?.claim ?? "",
        item.rumor?.impact ?? "",
        item.rumor?.evidenceSummary ?? "",
        item.rumor?.caveat ?? "",
        ...(item.corroboratingSources?.map((s) => `${s.sourceName} ${s.title}`) ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }

  const vendors = Array.from(new Set(SOURCES.map((s) => s.vendor)));

  return NextResponse.json(
    {
      updates: filtered,
      lastSyncedAt: store.lastSyncedAt,
      syncLogs: store.syncLogs,
      total: filtered.length,
      vendors,
      sources: SOURCES,
      evaluator,
      buildId: APP_BUILD_ID,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
