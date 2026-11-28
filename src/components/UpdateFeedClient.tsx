"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Cpu,
  ExternalLink,
  Filter,
  Monitor,
  Moon,
  Radar,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Terminal,
  User,
  X,
} from "lucide-react";
import type {
  Audience,
  Category,
  CredibilityLevel,
  Domain,
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
  domain?: Domain;
  initialUpdates: UpdateItem[];
  initialLastSyncedAt: string | null;
  initialSyncLogs: SyncSourceReport[];
  sources: SourceConfig[];
  evaluator: EvaluatorInfo;
  initialBuildId: string;
}

type ThemePreference = "system" | "light" | "dark";

const SUBSCRIPTIONS_KEY_AI = "intelligence-update:pinned-vendors";
const SUBSCRIPTIONS_KEY_HARDWARE = "intelligence-update:pinned-vendors:hardware";
const DEFAULT_PINNED_AI = ["OpenAI", "Anthropic", "Google", "Cursor"];
const DEFAULT_PINNED_HARDWARE = ["NVIDIA", "AMD", "Apple", "Intel"];
const THEME_KEY = "intelligence-update:theme";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_THROTTLE_MS = 30 * 1000;
const CLOCK_TICK_MS = 30 * 1000;
const PAGE_SIZE = 20;

const CATEGORY_LABELS: Record<Category, string> = {
  new_model: "New Model",
  new_feature: "New Feature",
  pricing: "Pricing & Limits",
  deprecation: "Deprecation",
  coding_tool: "Coding Tool / SDK",
  bugfix: "Bug Fix",
  research: "Research",
  gpu_accelerator: "GPU & Accelerators",
  cpu_silicon: "CPU & Silicon",
  memory_foundry: "Memory & Foundry",
  local_ai_hw: "Local AI Compute",
  driver_runtime: "Drivers & Runtimes",
  benchmark: "Benchmarks",
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
    className:
      "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25",
  },
  minor: {
    label: "MINOR",
    className:
      "bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/25",
  },
  patch: {
    label: "PATCH",
    className:
      "bg-black/[0.05] text-neutral-700 ring-1 ring-black/[0.08] dark:bg-white/[0.08] dark:text-neutral-300 dark:ring-white/[0.12]",
  },
};

const CREDIBILITY_STYLES: Record<
  CredibilityLevel,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  high: {
    label: "HIGH",
    className:
      "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25",
    icon: ShieldCheck,
  },
  medium: {
    label: "MEDIUM",
    className:
      "bg-amber-500/10 text-amber-800 ring-1 ring-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25",
    icon: AlertTriangle,
  },
  low: {
    label: "LOW",
    className:
      "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25",
    icon: ShieldAlert,
  },
  unverified: {
    label: "UNVERIFIED",
    className:
      "bg-black/[0.05] text-neutral-700 ring-1 ring-black/[0.08] dark:bg-white/[0.08] dark:text-neutral-300 dark:ring-white/[0.12]",
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
  domain = "ai",
  initialUpdates,
  initialLastSyncedAt,
  initialSyncLogs,
  sources,
  evaluator: initialEvaluator,
  initialBuildId,
}: UpdateFeedClientProps) {
  const subscriptionsKey =
    domain === "hardware" ? SUBSCRIPTIONS_KEY_HARDWARE : SUBSCRIPTIONS_KEY_AI;
  const defaultPinned =
    domain === "hardware" ? DEFAULT_PINNED_HARDWARE : DEFAULT_PINNED_AI;
  const [updates, setUpdates] = useState<UpdateItem[]>(initialUpdates);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialLastSyncedAt);
  const [syncLogs, setSyncLogs] = useState<SyncSourceReport[]>(initialSyncLogs);
  const [evaluator, setEvaluator] = useState<EvaluatorInfo>(initialEvaluator);
  const [availableBuildId, setAvailableBuildId] = useState<string | null>(null);
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null);

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
  const [pinnedVendors, setPinnedVendors] = useState<string[]>(defaultPinned);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const isPollingRef = useRef(false);
  const lastFetchedAtRef = useRef<number>(Date.now());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      if (savedTheme === "system" || savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
      }
      const saved = window.localStorage.getItem(subscriptionsKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPinnedVendors(parsed.filter((v): v is string => typeof v === "string"));
          return;
        }
      }
      setPinnedVendors(defaultPinned);
    } catch {
      // ignore localStorage errors
    }
  }, [subscriptionsKey, defaultPinned]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const isDark = theme === "dark" || (theme === "system" && mediaQuery.matches);
      document.documentElement.classList.toggle("dark", isDark);
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute("content", isDark ? "#202124" : "#f5f5f7");
      }
    };

    applyTheme();
    if (theme === "system") {
      mediaQuery.addEventListener("change", applyTheme);
      return () => mediaQuery.removeEventListener("change", applyTheme);
    }
    return undefined;
  }, [theme]);

  const handleSelectTheme = (next: ThemePreference) => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore localStorage errors
    }
  };

  const refreshFromServer = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const apiDomain = domain === "hardware" ? "compute" : "ai";
      const res = await fetch(`/api/updates?domain=${apiDomain}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        updates?: UpdateItem[];
        syncLogs?: SyncSourceReport[];
        lastSyncedAt?: string | null;
        evaluator?: EvaluatorInfo;
        buildId?: string;
      };
      if (Array.isArray(data.updates)) setUpdates(data.updates);
      if (Array.isArray(data.syncLogs)) setSyncLogs(data.syncLogs);
      if (data.lastSyncedAt !== undefined) setLastSyncedAt(data.lastSyncedAt);
      if (data.evaluator) setEvaluator(data.evaluator);
      if (data.buildId && initialBuildId && data.buildId !== initialBuildId) {
        setAvailableBuildId(data.buildId);
      }
      const now = Date.now();
      lastFetchedAtRef.current = now;
      setNowMs(now);
    } catch {
      // Ignore transient polling errors
    } finally {
      isPollingRef.current = false;
    }
  }, [domain, initialBuildId]);

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
        window.localStorage.setItem(subscriptionsKey, JSON.stringify(next));
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

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    activeTrack,
    audienceFilter,
    majorOnly,
    subscribedOnly,
    selectedOfficialVendor,
    credibilityFilter,
    rumorTypeFilter,
    selectedRumorVendor,
    searchQuery,
  ]);

  const visibleUpdates = useMemo(
    () => filteredUpdates.slice(0, visibleCount),
    [filteredUpdates, visibleCount]
  );
  const hasMore = visibleUpdates.length < filteredUpdates.length;

  useEffect(() => {
    if (!hasMore) return undefined;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredUpdates.length));
        }
      },
      { rootMargin: "320px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, filteredUpdates.length]);

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
  const showUpdateBanner = Boolean(
    availableBuildId && availableBuildId !== dismissedBuildId
  );

  return (
    <div className="min-h-screen pb-16">
      {/* Seamless Top Header */}
      <header className="mx-auto max-w-4xl px-4 pt-6 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <img
                src="/logo.png"
                alt="Intelligence Update"
                width={36}
                height={36}
                className="h-8 w-8 shrink-0 rounded-lg shadow-xs sm:h-9 sm:w-9"
              />
              <h1
                translate="no"
                className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-2xl"
              >
                Intelligence Update
              </h1>
              <nav
                aria-label="Feed domain"
                className="glass-inset inline-flex items-center rounded-xl p-1"
              >
                <Link
                  href="/ai"
                  translate="no"
                  aria-current={domain === "ai" ? "page" : undefined}
                  className={`inline-flex min-h-[30px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    domain === "ai"
                      ? "bg-white text-neutral-900 shadow-xs dark:bg-white/[0.14] dark:text-white"
                      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI</span>
                </Link>
                <Link
                  href="/compute"
                  translate="no"
                  aria-current={domain === "hardware" ? "page" : undefined}
                  className={`inline-flex min-h-[30px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    domain === "hardware"
                      ? "bg-white text-neutral-900 shadow-xs dark:bg-white/[0.14] dark:text-white"
                      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                  }`}
                >
                  <Cpu className="h-3.5 w-3.5" />
                  <span>Compute</span>
                </Link>
              </nav>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              className="glass-card inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-white/90 dark:text-neutral-200 dark:hover:bg-white/[0.12]"
            >
              <Radio className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Sources ({sources.length})</span>
            </button>

            <div
              role="group"
              aria-label="Theme mode"
              className="glass-inset inline-flex items-center rounded-xl p-1"
            >
              {(
                [
                  { id: "system", label: "Auto", icon: Monitor },
                  { id: "light", label: "Light", icon: Sun },
                  { id: "dark", label: "Dark", icon: Moon },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectTheme(id)}
                    aria-pressed={active}
                    title={`Theme: ${label}`}
                    className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-white text-neutral-900 shadow-xs dark:bg-white/[0.14] dark:text-white"
                        : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Compact Meta Row */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Last checked:{" "}
              <strong
                key={relativeLastChecked}
                suppressHydrationWarning
                title={
                  lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("en-US") : undefined
                }
                className="font-medium text-neutral-800 dark:text-neutral-200"
              >
                {relativeLastChecked}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Auto-sync every 30m · Auto-refresh every 5m</span>
            </span>
          </div>
          <span key={`${activeTrack}-${filteredUpdates.length}-${activeTotal}`}>
            Showing{" "}
            <strong translate="no" className="font-semibold text-neutral-900 dark:text-neutral-100">
              {filteredUpdates.length}
            </strong>{" "}
            of{" "}
            <span translate="no" className="font-medium text-neutral-700 dark:text-neutral-300">
              {activeTotal}
            </span>
          </span>
        </div>
      </header>

      {/* Consolidated Non-Sticky Frosted Matte Glass Dock */}
      <section className="mx-auto max-w-4xl px-4">
        <div className="glass-dock flex flex-col gap-3 rounded-3xl p-3.5 sm:p-4">
          {/* Row 1: Primary Track Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTrack("official")}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-2xl px-4 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
                activeTrack === "official"
                  ? "bg-blue-600/18 text-blue-900 ring-1 ring-blue-600/35 shadow-xs dark:bg-blue-500/26 dark:text-blue-100 dark:ring-blue-400/45"
                  : "bg-blue-500/[0.06] text-blue-800/75 ring-1 ring-blue-500/15 hover:bg-blue-500/12 dark:bg-blue-500/[0.08] dark:text-blue-200/75 dark:ring-blue-400/18 dark:hover:bg-blue-500/14"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Official</span>
              <span
                translate="no"
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTrack === "official"
                    ? "bg-blue-600/15 text-blue-900 dark:bg-blue-300/20 dark:text-blue-50"
                    : "bg-blue-600/10 text-blue-800/80 dark:bg-blue-400/15 dark:text-blue-200/80"
                }`}
              >
                {officialItems.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTrack("rumor")}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-2xl px-4 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${
                activeTrack === "rumor"
                  ? "bg-amber-500/20 text-amber-950 ring-1 ring-amber-600/35 shadow-xs dark:bg-amber-500/24 dark:text-amber-100 dark:ring-amber-400/45"
                  : "bg-amber-500/[0.07] text-amber-900/75 ring-1 ring-amber-500/18 hover:bg-amber-500/12 dark:bg-amber-500/[0.08] dark:text-amber-200/75 dark:ring-amber-400/18 dark:hover:bg-amber-500/14"
              }`}
            >
              <Radar className="h-4 w-4" />
              <span>Signals</span>
              <span
                translate="no"
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  activeTrack === "rumor"
                    ? "bg-amber-600/15 text-amber-950 dark:bg-amber-300/20 dark:text-amber-50"
                    : "bg-amber-600/10 text-amber-900/80 dark:bg-amber-400/15 dark:text-amber-200/80"
                }`}
              >
                {rumorItems.length}
              </span>
            </button>
          </div>

          {/* Row 2: Track-specific Filters + Search */}
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
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
                        active
                          ? "bg-blue-600/16 text-blue-900 ring-1 ring-blue-600/35 shadow-xs dark:bg-blue-500/24 dark:text-blue-100 dark:ring-blue-400/45"
                          : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
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
                  className={`inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 ${
                    majorOnly
                      ? "bg-rose-500/16 text-rose-800 ring-1 ring-rose-500/35 shadow-xs dark:bg-rose-500/22 dark:text-rose-200 dark:ring-rose-400/45"
                      : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
                  }`}
                >
                  <span>Major Only</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubscribedOnly((v) => !v)}
                  className={`inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${
                    subscribedOnly
                      ? "bg-amber-500/18 text-amber-950 ring-1 ring-amber-600/35 shadow-xs dark:bg-amber-500/22 dark:text-amber-100 dark:ring-amber-400/45"
                      : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
                  }`}
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      subscribedOnly
                        ? "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400"
                        : ""
                    }`}
                  />
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
                    className={`inline-flex min-h-[38px] items-center rounded-xl px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${
                      credibilityFilter === id
                        ? "bg-amber-500/18 text-amber-950 ring-1 ring-amber-600/35 shadow-xs dark:bg-amber-500/22 dark:text-amber-100 dark:ring-amber-400/45"
                        : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <select
                  value={rumorTypeFilter}
                  onChange={(e) => setRumorTypeFilter(e.target.value as "all" | RumorType)}
                  aria-label="Filter by signal type"
                  className="glass-inset h-[38px] rounded-xl px-2.5 text-xs font-medium text-neutral-800 focus:border-neutral-400 focus:outline-none dark:text-neutral-200 dark:focus:border-white/30"
                >
                  <option value="all" className="bg-white dark:bg-[#292a2d]">
                    All Signal Types
                  </option>
                  <option value="unreleased_leak" className="bg-white dark:bg-[#292a2d]">
                    Unreleased Leaks
                  </option>
                  <option value="insider_report" className="bg-white dark:bg-[#292a2d]">
                    Insider Reports
                  </option>
                  <option value="community_buzz" className="bg-white dark:bg-[#292a2d]">
                    Community Buzz
                  </option>
                  <option value="early_research" className="bg-white dark:bg-[#292a2d]">
                    Early Research
                  </option>
                </select>
              </div>
            )}

            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  domain === "hardware"
                    ? activeTrack === "official"
                      ? "Search GPUs, chips, CUDA, ROCm, MLX..."
                      : "Search silicon signals, HBM, benchmarks..."
                    : activeTrack === "official"
                    ? "Search models, features, SDKs..."
                    : "Search signals, leaks, analysis..."
                }
                className="glass-inset h-[38px] w-full rounded-xl pl-8 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-white/30"
              />
            </div>
          </div>

          {/* Row 3: Wrapped Vendor Chips (No horizontal scroll) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedVendor("all")}
              className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 ${
                activeTrack === "official"
                  ? "focus-visible:ring-blue-400/50"
                  : "focus-visible:ring-amber-400/50"
              } ${
                selectedVendor === "all"
                  ? activeTrack === "official"
                    ? "bg-blue-600/16 text-blue-900 ring-1 ring-blue-600/35 shadow-xs dark:bg-blue-500/24 dark:text-blue-100 dark:ring-blue-400/45"
                    : "bg-amber-500/18 text-amber-950 ring-1 ring-amber-600/35 shadow-xs dark:bg-amber-500/22 dark:text-amber-100 dark:ring-amber-400/45"
                  : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
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
                  className={`inline-flex min-h-[32px] items-center rounded-full transition ${
                    isSelected
                      ? activeTrack === "official"
                        ? "bg-blue-600/16 text-blue-900 ring-1 ring-blue-600/35 shadow-xs dark:bg-blue-500/24 dark:text-blue-100 dark:ring-blue-400/45"
                        : "bg-amber-500/18 text-amber-950 ring-1 ring-amber-600/35 shadow-xs dark:bg-amber-500/22 dark:text-amber-100 dark:ring-amber-400/45"
                      : "bg-black/[0.04] text-neutral-700 ring-1 ring-black/[0.07] hover:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]"
                  }`}
                >
                  <button
                    type="button"
                    translate="no"
                    onClick={() => setSelectedVendor(isSelected ? "all" : vendor)}
                    className={`rounded-l-full py-1 pl-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 ${
                      activeTrack === "official"
                        ? "pr-1.5 focus-visible:ring-blue-400/50"
                        : "rounded-r-full pr-3 focus-visible:ring-amber-400/50"
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
                      className="rounded-r-full py-1 pl-1 pr-2.5 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                    >
                      <Star
                        className={`h-3 w-3 ${
                          isPinned
                            ? "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400"
                            : isSelected
                            ? "text-blue-600/50 dark:text-blue-300/60"
                            : "text-neutral-400 dark:text-neutral-500"
                        }`}
                      />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Feed */}
      <main className="mx-auto mt-5 max-w-4xl px-4">
        {activeTrack === "rumor" && (
          <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-900 backdrop-blur-md dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p>
                <strong>How Signals Works:</strong>{" "}
                {domain === "hardware"
                  ? "Collects silicon/GPU leaks, foundry & HBM supply-chain reports, architecture deep dives, and community threads across "
                  : "Collects unconfirmed leaks, press scoops, early papers, and community threads across "}
                <span translate="no">{rumorSources.length}</span> sources every hour.
              </p>
              <p className="text-amber-900/85 dark:text-amber-200/85">
                Incoming items pass 2-stage deduplication (canonical URL matching + 72h
                semantic clustering that merges corroborating sources), spam filtering, and
                structured briefing synthesis (claim, impact, evidence, caveat) with 0–100
                credibility scoring{" "}
                {evaluator.mode === "gemini" ? (
                  <>
                    by <span translate="no">Gemini ({evaluator.model})</span>
                  </>
                ) : (
                  "via rule-based fallback"
                )}
                .
              </p>
            </div>
          </div>
        )}

        {filteredUpdates.length === 0 ? (
          <div className="glass-card rounded-3xl p-10 text-center">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {(activeTrack === "official" ? officialItems.length : rumorItems.length) === 0
                ? `No ${activeTrack === "official" ? "official updates" : "signals"} collected yet.`
                : "No items match your active filters."}
            </p>
            <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              {(activeTrack === "official" ? officialItems.length : rumorItems.length) === 0
                ? "Updates are collected automatically every 30 minutes."
                : "Reset filters or try a different search query."}
            </p>
            {(activeTrack === "official" ? officialItems.length : rumorItems.length) > 0 && (
              <button
                type="button"
                onClick={resetActiveFilters}
                className="glass-inset mt-4 inline-flex items-center rounded-xl px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-black/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {visibleUpdates.map((item) => {
              if (item.track === "rumor" && item.rumor) {
                const credStyle = CREDIBILITY_STYLES[item.rumor.credibility];
                const CredIcon = credStyle.icon;
                return (
                  <article
                    key={item.id}
                    className="glass-card-rumor rounded-3xl p-4 transition hover:border-amber-500/35 dark:hover:border-amber-400/30 sm:p-5"
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
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
                          {RUMOR_TYPE_LABELS[item.rumor.rumorType]}
                        </span>
                        <span className="rounded-md bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-300">
                          {EVIDENCE_BASIS_LABELS[item.rumor.evidenceBasis]}
                        </span>
                        <span
                          translate="no"
                          className="rounded-md bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white/[0.14] dark:text-neutral-100"
                        >
                          {item.vendor}
                        </span>
                        <span
                          translate="no"
                          className="text-xs font-medium text-neutral-500 dark:text-neutral-400"
                        >
                          {item.sourceName}
                        </span>
                        {(item.corroboratingSources?.length ?? 1) > 1 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/25">
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
                        className="text-xs text-neutral-400 dark:text-neutral-500"
                      >
                        {formatRelativeTime(item.publishedAt, nowMs)}
                      </time>
                    </div>

                    <h2 className="mt-2.5 text-base font-bold leading-snug text-neutral-900 dark:text-neutral-50 sm:text-[17px]">
                      {item.headline}
                    </h2>

                    {item.headline !== item.title && (
                      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                        {item.title}
                      </p>
                    )}

                    <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 sm:text-sm">
                      {item.summary.map((line, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Credibility & Evidence Assessment Panel */}
                    <div className="glass-inset mt-3.5 space-y-1.5 rounded-2xl p-3 text-xs text-neutral-700 dark:text-neutral-300">
                      <p>
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                          Core Claim:{" "}
                        </span>
                        {item.rumor.claim}
                      </p>
                      {item.rumor.impact && (
                        <p>
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                            Why It Matters:{" "}
                          </span>
                          {item.rumor.impact}
                        </p>
                      )}
                      <p>
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                          Evidence / Basis:{" "}
                        </span>
                        {item.rumor.evidenceSummary}
                      </p>
                      <p className="text-neutral-600 dark:text-neutral-400">
                        <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                          Caveat / Unconfirmed:{" "}
                        </span>
                        {item.rumor.caveat}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-300">
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        <span
                          translate="no"
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                            item.rumor.evaluatedBy === "gemini"
                              ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "bg-black/[0.05] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300"
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
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-500/20 dark:bg-indigo-400/15 dark:text-indigo-300 dark:hover:bg-indigo-400/25"
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
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-white/[0.08]"
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
                  className="glass-card-official rounded-3xl p-4 transition hover:border-blue-600/35 dark:hover:border-blue-400/35 sm:p-5"
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
                        className="rounded-md bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white/[0.14] dark:text-neutral-100"
                      >
                        {item.vendor}
                      </span>
                      <span
                        translate="no"
                        className="text-xs font-medium text-neutral-500 dark:text-neutral-400"
                      >
                        {item.sourceName}
                      </span>
                    </div>

                    <time
                      dateTime={item.publishedAt}
                      title={new Date(item.publishedAt).toLocaleString("en-US")}
                      suppressHydrationWarning
                      className="text-xs text-neutral-400 dark:text-neutral-500"
                    >
                      {formatRelativeTime(item.publishedAt, nowMs)}
                    </time>
                  </div>

                  <h2 className="mt-2.5 text-base font-bold leading-snug text-neutral-900 dark:text-neutral-50 sm:text-[17px]">
                    {item.headline}
                  </h2>

                  {item.headline !== item.title && (
                    <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                      {item.title}
                    </p>
                  )}

                  <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 sm:text-sm">
                    {item.summary.map((line, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-600 dark:bg-blue-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  {item.devImpact && (
                    <div className="glass-inset mt-3 rounded-2xl px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                        Developer Note:{" "}
                      </span>
                      {item.devImpact}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-300">
                        {CATEGORY_LABELS[item.category]}
                      </span>
                      {item.audiences.includes("developer") && (
                        <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                          Developers
                        </span>
                      )}
                      {item.audiences.includes("general") && (
                        <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                          General
                        </span>
                      )}
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-400/15"
                    >
                      <span>Read Source</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              );
            })}

            {hasMore && (
              <div
                ref={loadMoreRef}
                key={`${activeTrack}-${visibleUpdates.length}-${filteredUpdates.length}`}
                className="flex justify-center pt-2"
              >
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredUpdates.length))
                  }
                  className="glass-card inline-flex min-h-[38px] items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-neutral-600 transition hover:bg-white/90 dark:text-neutral-300 dark:hover:bg-white/[0.12]"
                >
                  <span>Loading more updates</span>
                  <span translate="no" className="text-neutral-400 dark:text-neutral-500">
                    ({visibleUpdates.length}/{filteredUpdates.length})
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Sources Status Drawer / Modal */}
      {sourcesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm dark:bg-black/65 sm:items-center sm:p-4"
          onClick={() => setSourcesOpen(false)}
        >
          <div
            className="glass-modal max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 dark:border-white/[0.08]">
              <div>
                <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
                  Monitored Sources ({sources.length})
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {syncLogs.length > 0
                    ? `Latest sync: ${okSourceCount}/${sources.length} healthy`
                    : "No sync runs recorded yet."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesOpen(false)}
                className="rounded-xl p-2 text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {[
              { title: `Official Sources (${officialSources.length})`, items: officialSources },
              { title: `Signal Sources (${rumorSources.length})`, items: rumorSources },
            ].map((group) => (
              <div key={group.title} className="mt-4">
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  {group.title}
                </h4>
                <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                  {group.items.map((src) => {
                    const report = logBySourceId.get(src.id);
                    return (
                      <div key={src.id} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              translate="no"
                              className="text-xs font-bold text-neutral-900 dark:text-neutral-100"
                            >
                              {src.name}
                            </span>
                            <span
                              translate="no"
                              className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-300"
                            >
                              {src.vendor}
                            </span>
                            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">
                              {SOURCE_TYPE_LABELS[src.type]}
                            </span>
                          </div>
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block truncate text-[11px] text-neutral-400 hover:text-indigo-600 dark:text-neutral-500 dark:hover:text-indigo-300"
                          >
                            {src.url}
                          </a>
                          {report?.error && (
                            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                              {report.error}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 text-right">
                          {report ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                report.status === "ok"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : "bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                              }`}
                            >
                              {report.status === "ok"
                                ? `OK (${report.fetchedCount})`
                                : "Error"}
                            </span>
                          ) : (
                            <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-white/[0.08] dark:text-neutral-400">
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

      {showUpdateBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
        >
          <div className="glass-modal flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                  New version available
                </p>
                <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                  Refresh to load the latest interface.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => setDismissedBuildId(availableBuildId)}
                aria-label="Dismiss update notice"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-neutral-500 transition hover:bg-black/[0.06] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
