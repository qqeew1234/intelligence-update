import handler from "vinext/server/fetch-handler";
import { runSync } from "../src/lib/sync";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    _controller: ScheduledController,
    _env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runSync({ limitPerSource: 5 }).catch((err) => {
        console.error("[scheduled sync] failed:", err);
      })
    );
  },
} satisfies ExportedHandler<Env>;
