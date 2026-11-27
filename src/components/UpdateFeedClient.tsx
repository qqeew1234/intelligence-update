"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Filter,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Terminal,
  User,
  X,
} from "lucide-react";
import type {
  Audience,
  Category,
  Importance,
  SourceConfig,
  SourceType,
  SyncResult,
  SyncSourceReport,
  UpdateItem,
} from "@/lib/types";

interface UpdateFeedClientProps {
  initialUpdates: UpdateItem[];
  initialLastSyncedAt: string | null;
  initialSyncLogs: SyncSourceReport[];
  sources: SourceConfig[];
  llmProvider: "gemini" | "openai" | "rule";
}

const SUBSCRIPTIONS_KEY = "intelligence-update:pinned-vendors";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_THROTTLE_MS = 30 * 1000;
const CLOCK_TICK_MS = 30 * 1000;

const CATEGORY_LABELS: Record<Category, string> = {
  new_model: "신규 모델",
  new_feature: "새 기능",
  pricing: "가격/한도",
  deprecation: "지원 종료",
  coding_tool: "코딩 툴/SDK",
  bugfix: "버그 수정",
  research: "리서치",
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  rss: "RSS",
  atom: "GitHub Atom",
  openrouter_models: "Model API",
  html_changelog: "Changelog Diff",
};

const IMPORTANCE_STYLES: Record<Importance, { label: string; className: string }> = {
  major: {
    label: "MAJOR",
    className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
  minor: {
    label: "MINOR",
    className: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  },
  patch: {
    label: "PATCH",
    className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  },
};

function formatRelativeTimeKo(iso: string | null, nowMs: number): string {
  if (!iso) return "동기화 기록 없음";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "시간 불명";
  const diffSec = Math.floor((nowMs - time) / 1000);
  if (diffSec < 60) return "방금 전";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export function UpdateFeedClient({
  initialUpdates,
  initialLastSyncedAt,
  initialSyncLogs,
  sources,
  llmProvider,
}: UpdateFeedClientProps) {
  const [updates, setUpdates] = useState<UpdateItem[]>(initialUpdates);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialLastSyncedAt);
  const [syncLogs, setSyncLogs] = useState<SyncSourceReport[]>(initialSyncLogs);

  const [audienceFilter, setAudienceFilter] = useState<"all" | Audience>("all");
  const [majorOnly, setMajorOnly] = useState(false);
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedVendors, setPinnedVendors] = useState<string[]>([
    "OpenAI",
    "Anthropic",
    "Google",
    "Cursor",
  ]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const isSyncingRef = useRef(false);
  const isPollingRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SUBSCRIPTIONS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPinnedVendors(parsed.filter((v): v is string => typeof v === "string"));
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const refreshFromServer = useCallback(async () => {
    if (isPollingRef.current || isSyncingRef.current) return;
    isPollingRef.current = true;
    try {
      const res = await fetch("/api/updates", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        updates?: UpdateItem[];
        syncLogs?: SyncSourceReport[];
        lastSyncedAt?: string | null;
      };
      if (Array.isArray(data.updates)) setUpdates(data.updates);
      if (Array.isArray(data.syncLogs)) setSyncLogs(data.syncLogs);
      if (data.lastSyncedAt !== undefined) setLastSyncedAt(data.lastSyncedAt);
      const now = Date.now();
      lastFetchedAtRef.current = now;
      setNowMs(now);
    } catch {
      // ignore transient polling errors
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isSyncingRef.current) {
        void refreshFromServer();
      }
    }, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastFetchedAtRef.current >= VISIBILITY_THROTTLE_MS
      ) {
        void refreshFromServer();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshFromServer]);

  const togglePinVendor = (vendor: string) => {
    setPinnedVendors((prev) => {
      const next = prev.includes(vendor)
        ? prev.filter((v) => v !== vendor)
        : [...prev, vendor];
      try {
        window.localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage errors
      }
      return next;
    });
  };

  const vendors = useMemo(
    () => Array.from(new Set(sources.map((s) => s.vendor))),
    [sources]
  );

  const filteredUpdates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return updates.filter((item) => {
      if (audienceFilter !== "all" && !item.audiences.includes(audienceFilter)) {
        return false;
      }
      if (majorOnly && item.importance !== "major") {
        return false;
      }
      if (subscribedOnly && !pinnedVendors.includes(item.vendor)) {
        return false;
      }
      if (selectedVendor !== "all" && item.vendor !== selectedVendor) {
        return false;
      }
      if (q) {
        const haystack = [
          item.title,
          item.titleKo,
          item.vendor,
          item.sourceName,
          ...item.summaryKo,
          item.devImpact ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [updates, audienceFilter, majorOnly, subscribedOnly, pinnedVendors, selectedVendor, searchQuery]);

  const handleSyncNow = async () => {
    if (isSyncing) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    setToast(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as {
        result?: SyncResult;
        updates?: UpdateItem[];
        syncLogs?: SyncSourceReport[];
        lastSyncedAt?: string | null;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || "동기화 요청에 실패했습니다.");
      }
      if (Array.isArray(data.updates)) setUpdates(data.updates);
      if (Array.isArray(data.syncLogs)) setSyncLogs(data.syncLogs);
      if (data.lastSyncedAt !== undefined) setLastSyncedAt(data.lastSyncedAt);
      const now = Date.now();
      lastFetchedAtRef.current = now;
      setNowMs(now);

      const newCount = data.result?.totalNew ?? 0;
      const fetchedCount = data.result?.totalFetched ?? 0;
      setToast({
        type: "ok",
        message:
          newCount > 0
            ? `새 업데이트 ${newCount}건을 반영했습니다 (총 ${fetchedCount}건 확인).`
            : `최신 상태입니다 (${fetchedCount}건 확인, 새 변경점 없음).`,
      });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "동기화 중 오류가 발생했습니다.",
      });
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  };

  const logBySourceId = useMemo(
    () => new Map(syncLogs.map((l) => [l.sourceId, l])),
    [syncLogs]
  );

  const okSourceCount = useMemo(
    () => syncLogs.filter((l) => l.status === "ok").length,
    [syncLogs]
  );

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold tracking-tight text-white">
                IU
              </span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                지능 업데이트
              </h1>
              <span className="text-xs font-medium text-slate-400">Intelligence Update</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  llmProvider === "rule"
                    ? "bg-slate-100 text-slate-600"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                {llmProvider === "rule"
                  ? "규칙 요약 모드"
                  : `AI 요약 활성 (${llmProvider.toUpperCase()})`}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              “AI, 오늘 또 똑똑해졌나?” — 공식 변경점만 골라 3줄로 정리합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Radio className="h-3.5 w-3.5 text-emerald-600" />
              <span>모니터링 소스 ({sources.length}개)</span>
            </button>

            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>{isSyncing ? "수집 중..." : "지금 업데이트 확인"}</span>
            </button>
          </div>
        </div>

        {/* Meta Bar */}
        <div className="border-t border-slate-100 bg-slate-50/70">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                마지막 확인:{" "}
                <strong
                  suppressHydrationWarning
                  title={
                    lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("ko-KR") : undefined
                  }
                  className="font-medium text-slate-700"
                >
                  {formatRelativeTimeKo(lastSyncedAt, nowMs)}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>매시 정각 자동 수집 · 5분마다 화면 갱신</span>
              </span>
            </div>
            <span>
              표시 중{" "}
              <strong className="font-semibold text-slate-800">{filteredUpdates.length}</strong>건 /
              전체 {updates.length}건
            </span>
          </div>
        </div>
      </header>

      {/* Toast Feedback */}
      {toast && (
        <div className="mx-auto mt-3 max-w-4xl px-4">
          <div
            className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-medium shadow-sm ${
              toast.type === "ok"
                ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded p-1 hover:bg-black/5"
              aria-label="알림 닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3">
          {/* Row 1: Audience + Major/Subscribed Toggles + Search */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: "전체", icon: Filter },
                  { id: "developer", label: "개발자", icon: Terminal },
                  { id: "general", label: "일반·직장인", icon: User },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = audienceFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAudienceFilter(id)}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setMajorOnly((v) => !v)}
                className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  majorOnly
                    ? "bg-rose-600 text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                <span>메이저만 보기</span>
              </button>

              <button
                type="button"
                onClick={() => setSubscribedOnly((v) => !v)}
                className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  subscribedOnly
                    ? "bg-amber-500 text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${subscribedOnly ? "fill-white" : ""}`} />
                <span>내 구독 툴만 ({pinnedVendors.length})</span>
              </button>
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="모델·기능·키워드 검색"
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Row 2: Vendor Chips + Subscription Pin */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedVendor("all")}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                selectedVendor === "all"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              전체 벤더
            </button>

            {vendors.map((vendor) => {
              const isSelected = selectedVendor === vendor;
              const isPinned = pinnedVendors.includes(vendor);
              return (
                <div
                  key={vendor}
                  className={`inline-flex shrink-0 items-center rounded-full transition ${
                    isSelected
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedVendor(isSelected ? "all" : vendor)}
                    className="py-1 pl-3 pr-1.5 text-xs font-medium"
                  >
                    {vendor}
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePinVendor(vendor)}
                    title={isPinned ? `${vendor} 구독 해제` : `${vendor} 구독 추가`}
                    aria-label={`${vendor} 구독 토글`}
                    className="rounded-r-full py-1 pl-1 pr-2.5 hover:opacity-80"
                  >
                    <Star
                      className={`h-3 w-3 ${
                        isPinned
                          ? isSelected
                            ? "fill-amber-300 text-amber-300"
                            : "fill-amber-400 text-amber-400"
                          : isSelected
                          ? "text-indigo-200"
                          : "text-slate-300"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Feed */}
      <main className="mx-auto mt-4 max-w-4xl px-4">
        {filteredUpdates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-semibold text-slate-800">
              {updates.length === 0
                ? "아직 수집된 업데이트가 없습니다."
                : "선택한 필터 조건에 맞는 업데이트가 없습니다."}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              {updates.length === 0
                ? "상단의 [지금 업데이트 확인] 버튼을 누르면 12개 공식 소스에서 즉시 가져옵니다."
                : "필터를 초기화하거나 검색어를 변경해 보세요."}
            </p>
            {updates.length === 0 ? (
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                <span>지금 업데이트 가져오기</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAudienceFilter("all");
                  setMajorOnly(false);
                  setSubscribedOnly(false);
                  setSelectedVendor("all");
                  setSearchQuery("");
                }}
                className="mt-4 inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                필터 초기화
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredUpdates.map((item) => {
              const imp = IMPORTANCE_STYLES[item.importance];
              return (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-slate-300 sm:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${imp.className}`}
                      >
                        {imp.label}
                      </span>
                      <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {item.vendor}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {item.sourceName}
                      </span>
                    </div>

                    <time
                      dateTime={item.publishedAt}
                      title={new Date(item.publishedAt).toLocaleString("ko-KR")}
                      suppressHydrationWarning
                      className="text-xs text-slate-400"
                    >
                      {formatRelativeTimeKo(item.publishedAt, nowMs)}
                    </time>
                  </div>

                  <h2 className="mt-2.5 text-base font-bold leading-snug text-slate-900 sm:text-[17px]">
                    {item.titleKo}
                  </h2>

                  {item.titleKo !== item.title && (
                    <p className="mt-0.5 text-xs text-slate-400">{item.title}</p>
                  )}

                  <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-slate-700 sm:text-sm">
                    {item.summaryKo.map((line, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {item.devImpact && (
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200/70">
                      <span className="font-semibold text-slate-800">개발자 참고: </span>
                      {item.devImpact}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                        {CATEGORY_LABELS[item.category]}
                      </span>
                      {item.audiences.includes("developer") && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
                          개발자
                        </span>
                      )}
                      {item.audiences.includes("general") && (
                        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
                          일반·직장인
                        </span>
                      )}
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
                    >
                      <span>원문 보기</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Sources Status Drawer / Modal */}
      {sourcesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setSourcesOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  모니터링 소스 현황 ({sources.length}개)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {syncLogs.length > 0
                    ? `최근 동기화 정상 ${okSourceCount}/${sources.length}개`
                    : "아직 동기화 실행 기록이 없습니다."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 divide-y divide-slate-100">
              {sources.map((src) => {
                const report = logBySourceId.get(src.id);
                return (
                  <div key={src.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{src.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {src.vendor}
                        </span>
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                          {SOURCE_TYPE_LABELS[src.type]}
                        </span>
                      </div>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate text-[11px] text-slate-400 hover:text-indigo-600"
                      >
                        {src.url}
                      </a>
                      {report?.error && (
                        <p className="mt-1 text-[11px] text-rose-600">{report.error}</p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {report ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            report.status === "ok"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {report.status === "ok"
                            ? `정상 (${report.fetchedCount}건)`
                            : "오류"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                          대기 중
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
