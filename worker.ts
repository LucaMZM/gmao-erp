import app from "vinext/server/app-router-entry";
import { runPreventiveScheduler } from "@/lib/server/preventive-scheduler";

const worker = {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    _env: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(
      runPreventiveScheduler().then((result) => {
        if (result.status !== "COMPLETE")
          console.error("preventive scheduler incomplete", {
            runId: result.id,
            status: result.status,
            errors: result.errors,
          });
      }),
    );
  },
};

export default worker;
