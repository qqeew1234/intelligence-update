import { NextRequest, NextResponse } from "next/server";
import { readStore } from "@/lib/storage";
import { getRumorEvaluatorInfo } from "@/lib/summarizer";
import { runSync } from "@/lib/sync";
import type { Track } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const trackParam = request.nextUrl.searchParams.get("track");
    const track: Track | "all" =
      trackParam === "official" || trackParam === "rumor" ? trackParam : "all";

    const result = await runSync({ track });
    const [store, evaluator] = await Promise.all([readStore(), getRumorEvaluatorInfo()]);
    return NextResponse.json({
      result,
      totalCount: store.updates.length,
      updates: store.updates,
      syncLogs: store.syncLogs,
      lastSyncedAt: store.lastSyncedAt,
      evaluator,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to sync sources.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
