export async function getCloudflareEnv(): Promise<Record<string, unknown> | null> {
  try {
    const mod = await import("cloudflare:workers");
    return (mod?.env as unknown as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export async function getEnvVar(name: string): Promise<string | undefined> {
  const cfEnv = await getCloudflareEnv();
  const cfVal = cfEnv?.[name];
  if (typeof cfVal === "string" && cfVal.trim()) {
    return cfVal.trim();
  }
  const nodeVal = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return typeof nodeVal === "string" && nodeVal.trim() ? nodeVal.trim() : undefined;
}
