import handler from "vinext/server/fetch-handler";
import { runSync } from "../src/lib/sync";

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
    const track = utcMinutes >= 15 && utcMinutes < 45 ? "rumor" : "official";
    ctx.waitUntil(
      runSync({ track }).catch((err) => {
        console.error(`[scheduled sync:${track}] failed:`, err);
      })
    );
  },
} satisfies ExportedHandler<Env>;
