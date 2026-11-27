import { XMLParser } from "fast-xml-parser";
import { compactWhitespace, sha256, stripHtml, toIsoDate } from "./text";
import type { RawCandidate, SourceConfig, SourceSnapshot } from "./types";

const REQUEST_HEADERS = {
  "User-Agent": "IntelligenceUpdateBot/0.1 (+https://intel.yunyun.page)",
  Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/html, */*",
  "Cache-Control": "no-cache",
};

const AI_TOPIC_REGEX =
  /\b(ai|llm|openai|gpt-?\d|chatgpt|anthropic|claude|gemini|deepmind|deepseek|xai|grok|cursor|mistral|llama|qwen|ollama|nvidia|hugging\s*face|diffusion|agentic|mcp|inference|transformer)\b/i;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

export interface CollectSourceOutput {
  candidates: RawCandidate[];
  nextSnapshot: SourceSnapshot;
  fetchedCount: number;
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractXmlText(val: unknown): string {
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj["#text"] === "string" || typeof obj["#text"] === "number") {
      return String(obj["#text"]);
    }
    if (typeof obj["@_href"] === "string") {
      return obj["@_href"];
    }
  }
  return "";
}

function extractAtomLink(linkField: unknown, fallbackUrl: string): string {
  const links = asArray(linkField);
  for (const link of links) {
    if (typeof link === "string" && link.startsWith("http")) return link;
    if (link && typeof link === "object") {
      const obj = link as Record<string, unknown>;
      const rel = obj["@_rel"];
      const href = obj["@_href"];
      if (typeof href === "string" && (!rel || rel === "alternate")) {
        return href;
      }
    }
  }
  const firstObj = links.find((l) => l && typeof l === "object") as Record<string, unknown> | undefined;
  if (firstObj && typeof firstObj["@_href"] === "string") {
    return firstObj["@_href"];
  }
  return fallbackUrl;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function collectRssOrAtom(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit: number,
  nowIso: string
): Promise<CollectSourceOutput> {
  const xml = await fetchText(source.url);
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  const rawItems: RawCandidate[] = [];

  if (parsed.rss && typeof parsed.rss === "object") {
    const channel = (parsed.rss as Record<string, unknown>).channel as Record<string, unknown> | undefined;
    const items = asArray(channel?.item as Record<string, unknown>[]);
    for (const item of items) {
      const title = compactWhitespace(stripHtml(extractXmlText(item.title)));
      const link = extractXmlText(item.link) || source.url;
      const guid = extractXmlText(item.guid) || link || title;
      const rawDesc =
        extractXmlText(item["content:encoded"]) ||
        extractXmlText(item.description) ||
        extractXmlText(item.summary);
      const rawText = stripHtml(rawDesc).slice(0, 2500);
      const publishedAt = toIsoDate(
        extractXmlText(item.pubDate) ||
          extractXmlText(item.published) ||
          extractXmlText(item["dc:date"])
      );

      if (!title) continue;
      rawItems.push({
        externalId: `${source.id}:${guid}`,
        title,
        url: link,
        publishedAt,
        rawText: rawText || title,
        contentHash: sha256(`${title}\n${rawText}`),
      });
    }
  } else if (parsed.feed && typeof parsed.feed === "object") {
    const entries = asArray((parsed.feed as Record<string, unknown>).entry as Record<string, unknown>[]);
    for (const entry of entries) {
      const title = compactWhitespace(stripHtml(extractXmlText(entry.title)));
      const link = extractAtomLink(entry.link, source.url);
      const id = extractXmlText(entry.id) || link || title;
      const rawBody =
        extractXmlText(entry.content) ||
        extractXmlText(entry.summary);
      const rawText = stripHtml(rawBody).slice(0, 2500);
      const publishedAt = toIsoDate(
        extractXmlText(entry.published) || extractXmlText(entry.updated)
      );

      if (!title) continue;
      rawItems.push({
        externalId: `${source.id}:${id}`,
        title,
        url: link,
        publishedAt,
        rawText: rawText || title,
        contentHash: sha256(`${title}\n${rawText}`),
      });
    }
  } else {
    throw new Error("Unrecognized RSS/Atom XML root");
  }

  const filteredItems = source.aiFilter
    ? rawItems.filter((item) => AI_TOPIC_REGEX.test(`${item.title}\n${item.rawText}`))
    : rawItems;

  filteredItems.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  const candidates = filteredItems.slice(0, limit);
  const seenSet = new Set(prevSnapshot?.seenIds ?? []);
  for (const c of candidates) {
    seenSet.add(c.externalId);
  }

  return {
    candidates,
    fetchedCount: filteredItems.length,
    nextSnapshot: {
      sourceId: source.id,
      lastCheckedAt: nowIso,
      lastSuccessAt: nowIso,
      lastHash: sha256(candidates.map((c) => c.contentHash).join("|")),
      seenIds: Array.from(seenSet).slice(-500),
    },
  };
}

interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function formatPricePerMillion(perToken?: string): string {
  if (!perToken) return "TBD";
  const num = Number.parseFloat(perToken);
  if (!Number.isFinite(num)) return "TBD";
  if (num === 0) return "Free ($0)";
  const perMillion = num * 1_000_000;
  return `$${perMillion < 0.01 ? perMillion.toFixed(4) : perMillion.toFixed(2)}/1M`;
}

async function collectOpenRouterModels(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit: number,
  nowIso: string
): Promise<CollectSourceOutput> {
  const text = await fetchText(source.url);
  const json = JSON.parse(text) as { data?: OpenRouterModel[] };
  const models = Array.isArray(json.data) ? json.data : [];

  const sorted = [...models].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const prevSeen = new Set(prevSnapshot?.seenIds ?? []);
  const isFirstRun = prevSeen.size === 0;

  const targetModels = isFirstRun
    ? sorted.slice(0, Math.min(5, limit))
    : sorted.filter((m) => !prevSeen.has(m.id)).slice(0, limit);

  const candidates: RawCandidate[] = targetModels.map((m) => {
    const ctx = m.context_length ? `${m.context_length.toLocaleString("en-US")} tokens` : "N/A";
    const promptPrice = formatPricePerMillion(m.pricing?.prompt);
    const completionPrice = formatPricePerMillion(m.pricing?.completion);
    const desc = compactWhitespace(m.description ?? "").slice(0, 800);
    const rawText = [
      `Model ID: ${m.id}`,
      `Context Length: ${ctx}`,
      `Pricing: Input ${promptPrice}, Output ${completionPrice}`,
      desc ? `Description: ${desc}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const displayName = m.name || m.id;
    return {
      externalId: `${source.id}:${m.id}`,
      title: `New Model on OpenRouter: ${displayName}`,
      url: `https://openrouter.ai/${m.id}`,
      publishedAt: toIsoDate(m.created),
      rawText,
      contentHash: sha256(`${m.id}:${promptPrice}:${completionPrice}:${ctx}`),
    };
  });

  const allIds = models.map((m) => m.id);
  return {
    candidates,
    fetchedCount: models.length,
    nextSnapshot: {
      sourceId: source.id,
      lastCheckedAt: nowIso,
      lastSuccessAt: nowIso,
      lastHash: sha256(allIds.slice(0, 50).join("|")),
      seenIds: allIds.slice(0, 1500),
    },
  };
}

async function collectHtmlChangelog(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit: number,
  nowIso: string
): Promise<CollectSourceOutput> {
  const html = await fetchText(source.url);
  const candidates: RawCandidate[] = [];
  const seenUrls = new Set<string>();

  // Strategy 1: Parse <article> blocks commonly used by Cursor Changelog and similar sites.
  const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = articleRegex.exec(html)) !== null && candidates.length < limit) {
    const block = match[1];
    const hrefMatch = block.match(/href=["']([^"']*\/changelog[^"']*)["']/i);
    const headingMatch = block.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const timeMatch = block.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);

    const title = compactWhitespace(stripHtml(headingMatch?.[1] ?? ""));
    if (!title) continue;

    const rawHref = hrefMatch?.[1] ?? "/changelog";
    const resolvedUrl = rawHref.startsWith("http")
      ? rawHref
      : new URL(rawHref, source.url).toString();

    if (seenUrls.has(resolvedUrl + title)) continue;
    seenUrls.add(resolvedUrl + title);

    const rawText = stripHtml(block).slice(0, 2200);
    candidates.push({
      externalId: `${source.id}:${sha256(resolvedUrl + "::" + title).slice(0, 20)}`,
      title,
      url: resolvedUrl,
      publishedAt: toIsoDate(timeMatch?.[1]),
      rawText: rawText || title,
      contentHash: sha256(`${title}\n${rawText}`),
    });
  }

  // Strategy 2: Parse changelog anchor links if <article> tags are absent.
  if (candidates.length === 0) {
    const linkRegex = /<a\b[^>]*href=["'](\/changelog\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && candidates.length < limit) {
      const relHref = match[1];
      const anchorText = compactWhitespace(stripHtml(match[2]));
      if (!anchorText || anchorText.length < 4) continue;
      const resolvedUrl = new URL(relHref, source.url).toString();
      if (seenUrls.has(resolvedUrl)) continue;
      seenUrls.add(resolvedUrl);

      candidates.push({
        externalId: `${source.id}:${relHref}`,
        title: anchorText.slice(0, 140),
        url: resolvedUrl,
        publishedAt: nowIso,
        rawText: anchorText,
        contentHash: sha256(`${resolvedUrl}\n${anchorText}`),
      });
    }
  }

  // Strategy 3: Fallback page-section hash diff.
  if (candidates.length === 0) {
    const plain = stripHtml(html).slice(0, 3000);
    const pageHash = sha256(plain);
    if (plain && pageHash !== prevSnapshot?.lastHash) {
      candidates.push({
        externalId: `${source.id}:${pageHash.slice(0, 16)}`,
        title: `${source.name} page change detected`,
        url: source.url,
        publishedAt: nowIso,
        rawText: plain.slice(0, 1500),
        contentHash: pageHash,
      });
    }
  }

  const seenSet = new Set(prevSnapshot?.seenIds ?? []);
  for (const c of candidates) {
    seenSet.add(c.externalId);
  }

  return {
    candidates,
    fetchedCount: candidates.length,
    nextSnapshot: {
      sourceId: source.id,
      lastCheckedAt: nowIso,
      lastSuccessAt: nowIso,
      lastHash: sha256(candidates.map((c) => c.contentHash).join("|")),
      seenIds: Array.from(seenSet).slice(-500),
    },
  };
}

interface HnHit {
  objectID?: string;
  title?: string;
  url?: string | null;
  story_text?: string | null;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
}

async function collectHnAlgolia(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit: number,
  nowIso: string
): Promise<CollectSourceOutput> {
  const text = await fetchText(source.url);
  const json = JSON.parse(text) as { hits?: HnHit[] };
  const hits = Array.isArray(json.hits) ? json.hits : [];

  const aiHits = hits.filter((hit) => {
    const title = compactWhitespace(hit.title ?? "");
    if (!title) return false;
    const body = stripHtml(hit.story_text ?? "");
    return AI_TOPIC_REGEX.test(`${title}\n${body}`);
  });

  const candidates: RawCandidate[] = aiHits.slice(0, limit).map((hit) => {
    const id = String(hit.objectID ?? sha256(hit.title ?? nowIso).slice(0, 12));
    const title = compactWhitespace(hit.title ?? "Untitled HN Story");
    const hnUrl = `https://news.ycombinator.com/item?id=${id}`;
    const targetUrl = hit.url && hit.url.startsWith("http") ? hit.url : hnUrl;
    const body = stripHtml(hit.story_text ?? "").slice(0, 1500);
    const rawText = [
      `Engagement: ${hit.points ?? 0} points, ${hit.num_comments ?? 0} comments on Hacker News`,
      hit.author ? `Author: ${hit.author}` : "",
      `HN Discussion: ${hnUrl}`,
      body ? `Excerpt: ${body}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      externalId: `${source.id}:${id}`,
      title,
      url: targetUrl,
      publishedAt: toIsoDate(hit.created_at),
      rawText,
      contentHash: sha256(`${id}:${title}:${body.slice(0, 200)}`),
    };
  });

  const seenSet = new Set(prevSnapshot?.seenIds ?? []);
  for (const c of candidates) {
    seenSet.add(c.externalId);
  }

  return {
    candidates,
    fetchedCount: aiHits.length,
    nextSnapshot: {
      sourceId: source.id,
      lastCheckedAt: nowIso,
      lastSuccessAt: nowIso,
      lastHash: sha256(candidates.map((c) => c.contentHash).join("|")),
      seenIds: Array.from(seenSet).slice(-500),
    },
  };
}

interface HfDailyPaperEntry {
  publishedAt?: string;
  title?: string;
  summary?: string;
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    publishedAt?: string;
    upvotes?: number;
  };
}

async function collectHfDailyPapers(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit: number,
  nowIso: string
): Promise<CollectSourceOutput> {
  const text = await fetchText(source.url);
  const entries = JSON.parse(text) as HfDailyPaperEntry[];
  const list = Array.isArray(entries) ? entries : [];

  const sorted = [...list].sort(
    (a, b) => (b.paper?.upvotes ?? 0) - (a.paper?.upvotes ?? 0)
  );

  const candidates: RawCandidate[] = [];
  for (const entry of sorted.slice(0, limit)) {
    const paper = entry.paper;
    const paperId = paper?.id?.trim();
    const title = compactWhitespace(paper?.title ?? entry.title ?? "");
    if (!paperId || !title) continue;

    const abstractText = compactWhitespace(paper?.summary ?? entry.summary ?? "").slice(0, 1800);
    const upvotes = paper?.upvotes ?? 0;
    const rawText = [
      `Hugging Face Daily Papers (${upvotes} upvotes)`,
      abstractText ? `Abstract: ${abstractText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    candidates.push({
      externalId: `${source.id}:${paperId}`,
      title,
      url: `https://huggingface.co/papers/${paperId}`,
      publishedAt: toIsoDate(paper?.publishedAt ?? entry.publishedAt),
      rawText,
      contentHash: sha256(`${paperId}:${title}`),
    });
  }

  const seenSet = new Set(prevSnapshot?.seenIds ?? []);
  for (const c of candidates) {
    seenSet.add(c.externalId);
  }

  return {
    candidates,
    fetchedCount: list.length,
    nextSnapshot: {
      sourceId: source.id,
      lastCheckedAt: nowIso,
      lastSuccessAt: nowIso,
      lastHash: sha256(candidates.map((c) => c.contentHash).join("|")),
      seenIds: Array.from(seenSet).slice(-500),
    },
  };
}

export async function collectFromSource(
  source: SourceConfig,
  prevSnapshot: SourceSnapshot | undefined,
  limit = 5
): Promise<CollectSourceOutput> {
  const nowIso = new Date().toISOString();

  switch (source.type) {
    case "rss":
    case "atom":
      return collectRssOrAtom(source, prevSnapshot, limit, nowIso);
    case "openrouter_models":
      return collectOpenRouterModels(source, prevSnapshot, limit, nowIso);
    case "html_changelog":
      return collectHtmlChangelog(source, prevSnapshot, limit, nowIso);
    case "hn_algolia":
      return collectHnAlgolia(source, prevSnapshot, limit, nowIso);
    case "hf_daily_papers":
      return collectHfDailyPapers(source, prevSnapshot, limit, nowIso);
  }
}
