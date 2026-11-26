import { NextResponse } from "next/server";
import { readStore } from "@/lib/storage";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runSync({ limitPerSource: 5 });
    const store = await readStore();
    return NextResponse.json({
      result,
      totalCount: store.updates.length,
      updates: store.updates,
      syncLogs: store.syncLogs,
      lastSyncedAt: store.lastSyncedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "동기화 중 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
