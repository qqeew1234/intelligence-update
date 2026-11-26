import { getCloudflareEnv } from "./env";
import type { StoreData } from "./types";

const KV_STORE_KEY = "store:v1";

interface KvNamespaceLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

const DEFAULT_STORE: StoreData = {
  lastSyncedAt: null,
  updates: [],
  snapshots: {},
  syncLogs: [],
};

function normalizeStore(parsed: Partial<StoreData> | null | undefined): StoreData {
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_STORE, snapshots: {}, updates: [], syncLogs: [] };
  }
  return {
    lastSyncedAt: parsed.lastSyncedAt ?? null,
    updates: Array.isArray(parsed.updates) ? parsed.updates : [],
    snapshots:
      parsed.snapshots && typeof parsed.snapshots === "object" ? parsed.snapshots : {},
    syncLogs: Array.isArray(parsed.syncLogs) ? parsed.syncLogs : [],
  };
}

async function getKvBinding(): Promise<KvNamespaceLike | null> {
  const cfEnv = await getCloudflareEnv();
  const kv = cfEnv?.INTELLIGENCE_KV as KvNamespaceLike | undefined;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") {
    return kv;
  }
  return null;
}

export async function readStore(): Promise<StoreData> {
  const kv = await getKvBinding();
  if (kv) {
    const parsed = (await kv.get(KV_STORE_KEY, "json")) as Partial<StoreData> | null;
    return normalizeStore(parsed);
  }

  const [{ readFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const storePath = path.join(process.cwd(), "data", "store.json");
  try {
    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return normalizeStore(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ...DEFAULT_STORE, snapshots: {}, updates: [], syncLogs: [] };
    }
    throw err;
  }
}

export async function writeStore(data: StoreData): Promise<void> {
  const kv = await getKvBinding();
  if (kv) {
    await kv.put(KV_STORE_KEY, JSON.stringify(data));
    return;
  }

  const [{ mkdir, rename, writeFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const dataDir = path.join(process.cwd(), "data");
  const storePath = path.join(dataDir, "store.json");
  await mkdir(dataDir, { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tempPath, storePath);
}
