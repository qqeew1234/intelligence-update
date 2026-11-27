"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Filter,
  Radar,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  User,
  X,
} from "lucide-react";
import type {
  Audience,
  Category,
  CredibilityLevel,
  EvidenceBasis,
  Importance,
  RumorType,
  SourceConfig,
  SourceType,
  SyncSourceReport,
  Track,
  UpdateItem,
} from "@/lib/types";

interface EvaluatorInfo {
  mode: "gemini" | "rule";
  model: string;
}

interface UpdateFeedClientProps {
  initialUpdates: UpdateItem[];
  initialLastSyncedAt: string | null;
  initialSyncLogs: SyncSourceReport[];
  sources: SourceConfig[];
  evaluator: EvaluatorInfo;
}

const SUBSCRIPTIONS_KEY = "intelligence-update:pinned-vendors";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_THROTTLE_MS = 30 * 1000;
const CLOCK_TICK_MS = 30 * 1000;

const CATEGORY_LABELS: Record<Category, string> = {
  new_model: "New Model",
  new_feature: "New Feature",
  pricing: "Pricing & Limits",
  deprecation: "Deprecation",
  coding_tool: "Coding Tool / SDK",
  bugfix: "Bug Fix",
  research: "Research",
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  rss: "RSS",
  atom: "GitHub Atom",
  openrouter_models: "Model API",
  html_changelog: "Changelog Diff",
  hn_algolia: "HN API",
  hf_daily_papers: "HF Papers API",
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

const CREDIBILITY_STYLES: Record<
  CredibilityLevel,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  high: {
    label: "HIGH",
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    icon: ShieldCheck,
  },
  medium: {
    label: "MEDIUM",
    className: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    icon: AlertTriangle,
  },
  low: {
    label: "LOW",
    className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    icon: ShieldAlert,
  },
  unverified: {
    label: "UNVERIFIED",
    className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    icon: AlertCircle,
  },
};

const RUMOR_TYPE_LABELS: Record<RumorType, string> = {
  unreleased_leak: "Unreleased Leak",
  insider_report: "Insider Report",
  community_buzz: "Community Buzz",
  early_research: "Early Research",
};

const EVIDENCE_BASIS_LABELS: Record<EvidenceBasis, string> = {
  code_or_ui_artifact: "Code / UI Artifact",
  multiple_reports: "Multiple Reports",
  named_insider: "Named Insider",
  single_source: "Single Source",
  speculation: "Speculation",
};

function formatRelativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "Never synced";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "Unknown";
  const diffSec = Math.floor((nowMs - time) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UpdateFeedClient({
  initialUpdates,
  initialLastSyncedAt,
  initialSyncLogs,
  sources,
  evaluator: initialEvaluator,
}: UpdateFeedClientProps) {
  const [updates, setUpdates] = useState<UpdateItem[]>(initialUpdates);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialLastSyncedAt);
  const [syncLogs, setSyncLogs] = useState<SyncSourceReport[]>(initialSyncLogs);
  const [evaluator, setEvaluator] = useState<EvaluatorInfo>(initialEvaluator);

  const [activeTrack, setActiveTrack] = useState<Track>("official");

  // Official filters
  const [audienceFilter, setAudienceFilter] = useState<"all" | Audience>("all");
  const [majorOnly, setMajorOnly] = useState(false);
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [selectedOfficialVendor, setSelectedOfficialVendor] = useState<string>("all");

  // Rumor filters
  const [credibilityFilter, setCredibilityFilter] = useState<
    "all" | "high" | "medium_plus" | "unverified_low"
  >("all");
  const [rumorTypeFilter, setRumorTypeFilter] = useState<"all" | RumorType>("all");
  const [selectedRumorVendor, setSelectedRumorVendor] = useState<string>("all");

  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedVendors, setPinnedVendors] = useState<string[]>([
    "OpenAI",
    "Anthropic",
    "Google",
    "Cursor",
  ]);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

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
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const res = await fetch("/api/updates", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        updates?: UpdateItem[];
        syncLogs?: SyncSourceReport[];
        lastSyncedAt?: string | null;
        evaluator?: EvaluatorInfo;
      };
      if (Array.isArray(data.updates)) setUpdates(data.updates);
      if (Array.isArray(data.syncLogs)) setSyncLogs(data.syncLogs);
      if (data.lastSyncedAt !== undefined) setLastSyncedAt(data.lastSyncedAt);
      if (data.evaluator) setEvaluator(data.evaluator);
      const now = Date.now();
      lastFetchedAtRef.current = now;
      setNowMs(now);
    } catch {
      // Ignore transient polling errors
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
      if (document.visibilityState === "visible") {
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

  const officialItems = useMemo(
    () => updates.filter((u) => u.track === "official"),
    [updates]
  );
  const rumorItems = useMemo(() => updates.filter((u) => u.track === "rumor"), [updates]);

  const officialVendors = useMemo(
    () =>
      Array.from(
        new Set(sources.filter((s) => s.track === "official").map((s) => s.vendor))
      ),
    [sources]
  );

  const rumorVendors = useMemo(() => {
    const set = new Set<string>();
    for (const item of rumorItems) {
      if (item.vendor) set.add(item.vendor);
    }
    return Array.from(set);
  }, [rumorItems]);

  const activeVendors = activeTrack === "official" ? officialVendors : rumorVendors;
  const selectedVendor =
    activeTrack === "official" ? selectedOfficialVendor : selectedRumorVendor;
  const setSelectedVendor =
    activeTrack === "official" ? setSelectedOfficialVendor : setSelectedRumorVendor;

  const filteredUpdates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = activeTrack === "official" ? officialItems : rumorItems;

    return base.filter((item) => {
      if (activeTrack === "official") {
        if (audienceFilter !== "all" && !item.audiences.includes(audienceFilter)) {
          return false;
        }
        if (majorOnly && item.importance !== "major") {
          return false;
        }
        if (subscribedOnly && !pinnedVendors.includes(item.vendor)) {
          return false;
        }
        if (selectedOfficialVendor !== "all" && item.vendor !== selectedOfficialVendor) {
          return false;
        }
      } else {
        const cred = item.rumor?.credibility ?? "unverified";
        if (credibilityFilter === "high" && cred !== "high") return false;
        if (credibilityFilter === "medium_plus" && cred !== "high" && cred !== "medium") {
          return false;
        }
        if (
          credibilityFilter === "unverified_low" &&
          cred !== "unverified" &&
          cred !== "low"
        ) {
          return false;
        }
        if (rumorTypeFilter !== "all" && item.rumor?.rumorType !== rumorTypeFilter) {
          return false;
        }
        if (selectedRumorVendor !== "all" && item.vendor !== selectedRumorVendor) {
          return false;
        }
      }

      if (q) {
        const haystack = [
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
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    activeTrack,
    officialItems,
    rumorItems,
    audienceFilter,
    majorOnly,
    subscribedOnly,
    pinnedVendors,
    selectedOfficialVendor,
    credibilityFilter,
    rumorTypeFilter,
    selectedRumorVendor,
    searchQuery,
  ]);

  const logBySourceId = useMemo(
    () => new Map(syncLogs.map((l) => [l.sourceId, l])),
    [syncLogs]
  );

  const okSourceCount = useMemo(
    () => syncLogs.filter((l) => l.status === "ok").length,
    [syncLogs]
  );

  const officialSources = useMemo(
    () => sources.filter((s) => s.track === "official"),
    [sources]
  );
  const rumorSources = useMemo(
    () => sources.filter((s) => s.track === "rumor"),
    [sources]
  );

  const resetActiveFilters = () => {
    setSearchQuery("");
    if (activeTrack === "official") {
      setAudienceFilter("all");
      setMajorOnly(false);
      setSubscribedOnly(false);
      setSelectedOfficialVendor("all");
    } else {
      setCredibilityFilter("all");
      setRumorTypeFilter("all");
      setSelectedRumorVendor("all");
    }
  };

  const activeTotal =
    activeTrack === "official" ? officialItems.length : rumorItems.length;
  const relativeLastChecked = formatRelativeTime(lastSyncedAt, nowMs);

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                translate="no"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold tracking-tight text-white"
              >
                IU
              </span>
              <h1
                translate="no"
                className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"
              >
                Intelligence Update
              </h1>
              <span
                translate="no"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  evaluator.mode === "gemini"
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                {evaluator.mode === "gemini"
                  ? `Gemini Rumor Eval · ${evaluator.model}`
                  : "Heuristic Rumor Eval (Add GEMINI_API_KEY)"}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Official AI releases &amp; Gemini-evaluated rumor radar — zero fluff.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Radio className="h-3.5 w-3.5 text-emerald-600" />
              <span>Sources ({sources.length})</span>
            </button>
          </div>
        </div>

        {/* Meta Bar */}
        <div className="border-t border-slate-100 bg-slate-50/70">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Last checked:{" "}
                <strong
                  key={relativeLastChecked}
                  suppressHydrationWarning
                  title={
                    lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("en-US") : undefined
                  }
                  className="font-medium text-slate-700"
                >
                  {relativeLastChecked}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>Auto-sync every 30m · Auto-refresh every 5m</span>
              </span>
            </div>
            <span key={`${activeTrack}-${filteredUpdates.length}-${activeTotal}`}>
              Showing{" "}
              <strong translate="no" className="font-semibold text-slate-800">
                {filteredUpdates.length}
              </strong>{" "}
              of{" "}
              <span translate="no" className="font-medium text-slate-700">
                {activeTotal}
              </span>
            </span>
          </div>
        </div>

        {/* Primary Track Tabs */}
        <div className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setActiveTrack("official")}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                activeTrack === "official"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Official Updates</span>
              <span
                translate="no"
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTrack === "official"
                    ? "bg-white/15 text-white"
                    : "bg-white text-slate-600"
                }`}
              >
                {officialItems.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTrack("rumor")}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                activeTrack === "rumor"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              <Radar className="h-4 w-4" />
              <span>Rumor Radar</span>
              <span
                translate="no"
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTrack === "rumor"
                    ? "bg-white/20 text-white"
                    : "bg-white text-slate-600"
                }`}
              >
                {rumorItems.length}
              </span>
              <span
                className={`hidden rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:inline-block ${
                  activeTrack === "rumor"
                    ? "bg-amber-700/60 text-amber-50"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                }`}
              >
                AI Credibility &amp; Evidence
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3">
          {/* Row 1: Track-specific Filters + Search */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {activeTrack === "official" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: "all", label: "All", icon: Filter },
                    { id: "developer", label: "Developers", icon: Terminal },
                    { id: "general", label: "General", icon: User },
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
                  <span>Major Only</span>
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
                  <span>Pinned ({pinnedVendors.length})</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: "all", label: "All Credibility" },
                    { id: "high", label: "High" },
                    { id: "medium_plus", label: "Medium+" },
                    { id: "unverified_low", label: "Unverified / Low" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCredibilityFilter(id)}
                    className={`inline-flex min-h-[38px] items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      credibilityFilter === id
                        ? "bg-amber-600 text-white shadow-sm"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <select
                  value={rumorTypeFilter}
                  onChange={(e) => setRumorTypeFilter(e.target.value as "all" | RumorType)}
                  aria-label="Filter by rumor type"
                  className="h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  <option value="all">All Signal Types</option>
                  <option value="unreleased_leak">Unreleased Leaks</option>
                  <option value="insider_report">Insider Reports</option>
                  <option value="community_buzz">Community Buzz</option>
                  <option value="early_research">Early Research</option>
                </select>
              </div>
            )}

            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTrack === "official"
                    ? "Search models, features, SDKs..."
                    : "Search rumors, claims, evidence..."
                }
                className="h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Row 2: Vendor Chips */}
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
              All Vendors
            </button>

            {activeVendors.map((vendor) => {
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
                    translate="no"
                    onClick={() => setSelectedVendor(isSelected ? "all" : vendor)}
                    className={`py-1 pl-3 text-xs font-medium ${
                      activeTrack === "official" ? "pr-1.5" : "pr-3"
                    }`}
                  >
                    {vendor}
                  </button>
                  {activeTrack === "official" && (
                    <button
                      type="button"
                      onClick={() => togglePinVendor(vendor)}
                      title={isPinned ? `Unpin ${vendor}` : `Pin ${vendor}`}
                      aria-label={`Toggle ${vendor} subscription`}
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
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Feed */}
      <main className="mx-auto mt-4 max-w-4xl px-4">
        {activeTrack === "rumor" && (
          <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <strong>Unconfirmed Signals:</strong> Items on Rumor Radar aggregate leaks,
              insider scoops, and community discussions. Credibility scores and evidence
              assessments are{" "}
              {evaluator.mode === "gemini"
                ? `evaluated by Gemini (${evaluator.model})`
                : "generated by heuristic rules (add GEMINI_API_KEY for AI evaluation)"}
              .
            </p>
          </div>
        )}

        {filteredUpdates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-semibold text-slate-800">
              {(activeTrack === "official" ? officialItems.length : rumorItems.length) === 0
                ? `No ${activeTrack === "official" ? "official updates" : "rumor signals"} collected yet.`
                : "No items match your active filters."}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              {(activeTrack === "official" ? officialItems.length : rumorItems.length) === 0
                ? "Updates are collected automatically every 30 minutes."
                : "Reset filters or try a different search query."}
            </p>
            {(activeTrack === "official" ? officialItems.length : rumorItems.length) > 0 && (
              <button
                type="button"
                onClick={resetActiveFilters}
                className="mt-4 inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredUpdates.map((item) => {
              if (item.track === "rumor" && item.rumor) {
                const credStyle = CREDIBILITY_STYLES[item.rumor.credibility];
                const CredIcon = credStyle.icon;
                return (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-amber-200/80 bg-white p-4 shadow-xs transition hover:border-amber-300 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          translate="no"
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${credStyle.className}`}
                        >
                          <CredIcon className="h-3 w-3" />
                          <span>
                            {credStyle.label} · {item.rumor.credibilityScore}/100
                          </span>
                        </span>
                        <span className="rounded-md bg-amber-100/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                          {RUMOR_TYPE_LABELS[item.rumor.rumorType]}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {EVIDENCE_BASIS_LABELS[item.rumor.evidenceBasis]}
                        </span>
                        <span
                          translate="no"
                          className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white"
                        >
                          {item.vendor}
                        </span>
                        <span translate="no" className="text-xs font-medium text-slate-500">
                          {item.sourceName}
                        </span>
                        {(item.corroboratingSources?.length ?? 1) > 1 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                            Corroborated ·{" "}
                            <span translate="no">{item.corroboratingSources!.length}</span>{" "}
                            Sources
                          </span>
                        )}
                      </div>

                      <time
                        dateTime={item.publishedAt}
                        title={new Date(item.publishedAt).toLocaleString("en-US")}
                        suppressHydrationWarning
                        className="text-xs text-slate-400"
                      >
                        {formatRelativeTime(item.publishedAt, nowMs)}
                      </time>
                    </div>

                    <h2 className="mt-2.5 text-base font-bold leading-snug text-slate-900 sm:text-[17px]">
                      {item.headline}
                    </h2>

                    {item.headline !== item.title && (
                      <p className="mt-0.5 text-xs text-slate-400">{item.title}</p>
                    )}

                    <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-slate-700 sm:text-sm">
                      {item.summary.map((line, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Credibility & Evidence Assessment Panel */}
                    <div className="mt-3.5 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200/80">
                      <p>
                        <span className="font-semibold text-slate-900">Core Claim: </span>
                        {item.rumor.claim}
                      </p>
                      {item.rumor.impact && (
                        <p>
                          <span className="font-semibold text-slate-900">Why It Matters: </span>
                          {item.rumor.impact}
                        </p>
                      )}
                      <p>
                        <span className="font-semibold text-slate-900">Evidence / Basis: </span>
                        {item.rumor.evidenceSummary}
                      </p>
                      <p className="text-slate-600">
                        <span className="font-semibold text-slate-800">
                          Caveat / Unconfirmed:{" "}
                        </span>
                        {item.rumor.caveat}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <span
                          translate="no"
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                            item.rumor.evaluatedBy === "gemini"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          <Sparkles className="h-3 w-3" />
                          {item.rumor.evaluatedBy === "gemini"
                            ? `Evaluated by Gemini (${item.rumor.model ?? evaluator.model})`
                            : "Heuristic Eval"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {(item.corroboratingSources?.length ?? 1) > 1 ? (
                          item.corroboratingSources!.map((src, idx) => (
                            <a
                              key={`${src.sourceId}-${idx}`}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              translate="no"
                              title={src.title}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-indigo-50/70 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                              <span>{src.sourceName}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))
                        ) : (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
                          >
                            <span>Read Source</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              }

              const imp = IMPORTANCE_STYLES[item.importance];
              return (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-slate-300 sm:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        translate="no"
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${imp.className}`}
                      >
                        {imp.label}
                      </span>
                      <span
                        translate="no"
                        className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white"
                      >
                        {item.vendor}
                      </span>
                      <span translate="no" className="text-xs font-medium text-slate-500">
                        {item.sourceName}
                      </span>
                    </div>

                    <time
                      dateTime={item.publishedAt}
                      title={new Date(item.publishedAt).toLocaleString("en-US")}
                      suppressHydrationWarning
                      className="text-xs text-slate-400"
                    >
                      {formatRelativeTime(item.publishedAt, nowMs)}
                    </time>
                  </div>

                  <h2 className="mt-2.5 text-base font-bold leading-snug text-slate-900 sm:text-[17px]">
                    {item.headline}
                  </h2>

                  {item.headline !== item.title && (
                    <p className="mt-0.5 text-xs text-slate-400">{item.title}</p>
                  )}

                  <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-slate-700 sm:text-sm">
                    {item.summary.map((line, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {item.devImpact && (
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200/70">
                      <span className="font-semibold text-slate-800">Developer Note: </span>
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
                          Developers
                        </span>
                      )}
                      {item.audiences.includes("general") && (
                        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
                          General
                        </span>
                      )}
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
                    >
                      <span>Read Source</span>
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
                  Monitored Sources ({sources.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {syncLogs.length > 0
                    ? `Latest sync: ${okSourceCount}/${sources.length} healthy`
                    : "No sync runs recorded yet."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {[
              { title: `Official Sources (${officialSources.length})`, items: officialSources },
              { title: `Rumor & Signal Sources (${rumorSources.length})`, items: rumorSources },
            ].map((group) => (
              <div key={group.title} className="mt-4">
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {group.title}
                </h4>
                <div className="divide-y divide-slate-100">
                  {group.items.map((src) => {
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
                                ? `OK (${report.fetchedCount})`
                                : "Error"}
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                              Pending
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
