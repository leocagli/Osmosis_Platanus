import { processExpiredHackathons, processQueuedGenLayerHackathons } from "@buildersclaw/shared/judge-trigger";
import { continueGenLayerJudging, judgeHackathon } from "@buildersclaw/shared/judge";
import { processTelegramUpdate } from "@buildersclaw/shared/telegram-webhook";
import { dispatchQueuedWebhookDelivery } from "@buildersclaw/shared/agent-webhooks";
import { enqueueJob, pruneTerminalJobs, type JobRecord } from "@buildersclaw/shared/queue";
import { runEscrowFinalization } from "@buildersclaw/shared/finalization";
import * as pipeline from "@buildersclaw/shared/judging-pipeline";

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

    case "judging.freeze_submissions": {
      const hackathonId = getString(payload, "hackathon_id");
      const judgingRunId = getString(payload, "judging_run_id");
      if (!hackathonId || !judgingRunId) throw new Error("judging.freeze_submissions missing payload");
      await pipeline.freezeSubmissions(hackathonId, judgingRunId);
      return;
    }

    case "judging.repo_score": {
      const hackathonId = getString(payload, "hackathon_id");
      const submissionId = getString(payload, "submission_id");
      if (!hackathonId || !submissionId) throw new Error("judging.repo_score missing payload");
      await pipeline.repoScore(hackathonId, submissionId);
      return;
    }

    case "judging.runtime_score": {
      const hackathonId = getString(payload, "hackathon_id");
      const submissionId = getString(payload, "submission_id");
      if (!hackathonId || !submissionId) throw new Error("judging.runtime_score missing payload");
      await pipeline.runtimeScore(hackathonId, submissionId);
      return;
    }

    case "judging.assign_peer_reviews": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("judging.assign_peer_reviews missing hackathon_id");
      await pipeline.assignPeerReviews(hackathonId);
      return;
    }

    case "judging.close_peer_reviews": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("judging.close_peer_reviews missing hackathon_id");
      await pipeline.closePeerReviews(hackathonId);
      return;
    }

    case "judging.aggregate_finalists": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("judging.aggregate_finalists missing hackathon_id");
      await pipeline.aggregateFinalists(hackathonId);
      return;
    }

    case "genlayer.start": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("genlayer.start missing hackathon_id");
      await pipeline.startGenLayer(hackathonId);
      return;
    }

    case "genlayer.continue": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("genlayer.continue missing hackathon_id");
      await pipeline.continueGenLayer(hackathonId);
      return;
    }

    case "genlayer.persist": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("genlayer.persist missing hackathon_id");
      await pipeline.persistGenLayerResult(hackathonId);
      return;
    }

    case "genlayer.notify": {
      const hackathonId = getString(payload, "hackathon_id");
      if (!hackathonId) throw new Error("genlayer.notify missing hackathon_id");
      await pipeline.notifyGenLayerResult(hackathonId);
      return;
    }

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
