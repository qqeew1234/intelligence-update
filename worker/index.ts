import handler from "vinext/server/fetch-handler";
import { runSync } from "../src/lib/sync";
import type { Domain, Track } from "../src/lib/types";

function getScheduledTarget(utcMinutes: number): { domain: Domain; track: Track } {
  if (utcMinutes >= 45) return { domain: "hardware", track: "rumor" };
  if (utcMinutes >= 30) return { domain: "ai", track: "rumor" };
  if (utcMinutes >= 15) return { domain: "hardware", track: "official" };
  return { domain: "ai", track: "official" };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    _env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const utcMinutes = new Date(controller.scheduledTime).getUTCMinutes();
    const { domain, track } = getScheduledTarget(utcMinutes);
    ctx.waitUntil(
      runSync({ domain, track }).catch((err) => {
        console.error(`[scheduled sync:${domain}:${track}] failed:`, err);
      })
    );
  },
} satisfies ExportedHandler<Env>;
