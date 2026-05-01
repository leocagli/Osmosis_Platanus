import { processExpiredHackathons, processQueuedGenLayerHackathons } from "../../web/src/lib/judge-trigger";
import { continueGenLayerJudging, judgeHackathon } from "../../web/src/lib/judge";
import { processTelegramUpdate } from "../../web/src/lib/telegram-webhook";
import { dispatchQueuedWebhookDelivery } from "../../web/src/lib/agent-webhooks";
import { enqueueJob, pruneTerminalJobs, type JobRecord } from "../../web/src/lib/queue";
import { runEscrowFinalization } from "../../web/src/lib/finalization";

function getString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export async function handleJob(job: JobRecord) {
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  switch (job.type) {
    case "process_expired_hackathons":
      await processExpiredHackathons({ enqueueOnly: true });
      await processQueuedGenLayerHackathons({ enqueueOnly: true });
      return;

    case "continue_genlayer_judging": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("continue_genlayer_judging requires hackathon_id");
      const done = await continueGenLayerJudging(hackathonId);
      if (!done) {
        await enqueueJob({
          type: "continue_genlayer_judging",
          payload: { hackathon_id: hackathonId },
          runAt: new Date(Date.now() + 60_000),
          maxAttempts: 20,
        });
      }
      return;
    }

    case "judge_hackathon": {
      const hackathonId = getString(payload, "hackathon_id");
      const judgingRunId = getString(payload, "judging_run_id");
      if (!hackathonId) throw new Error("judge_hackathon requires hackathon_id");
      await judgeHackathon(hackathonId, judgingRunId ?? undefined);
      return;
    }

    case "telegram.process_update":
      await processTelegramUpdate(payload.update as Parameters<typeof processTelegramUpdate>[0]);
      return;

    case "agent_webhook.deliver": {
      const deliveryId = getString(payload, "delivery_id");
      if (!deliveryId) throw new Error("agent_webhook.deliver requires delivery_id");
      await dispatchQueuedWebhookDelivery(deliveryId);
      return;
    }

    case "escrow.finalize": {
      const finalizationRunId = getString(payload, "finalization_run_id");
      if (!finalizationRunId) throw new Error("escrow.finalize requires finalization_run_id");
      await runEscrowFinalization(finalizationRunId);
      return;
    }

    case "jobs.prune":
      await pruneTerminalJobs();
      await enqueueJob({ type: "jobs.prune", payload: {}, runAt: new Date(Date.now() + 24 * 60 * 60 * 1000), maxAttempts: 3 });
      return;

    default:
      throw new Error(`No handler for job type ${job.type}`);
  }
}
