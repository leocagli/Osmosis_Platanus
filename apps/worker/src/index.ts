import { randomUUID } from "crypto";
import { claimDueJob, completeJob, failOrRetryJob, type JobRecord } from "@buildersclaw/shared/queue";
import { handleJob } from "./jobs";

const workerId = process.env.WORKER_ID || `worker-${randomUUID()}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS || "2000", 10);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(job: JobRecord) {
  try {
    await handleJob(job);
    await completeJob(job.id, workerId);
    console.log(`[worker] completed ${job.type} ${job.id}`);
  } catch (error) {
    const state = await failOrRetryJob(job, error);
    console.error(`[worker] ${state} ${job.type} ${job.id}:`, error instanceof Error ? error.message : error);
  }
}

async function loop() {
  console.log(`[worker] starting ${workerId}`);

  while (!stopping) {
    let job: JobRecord | null = null;
    try {
      job = await claimDueJob(workerId);
    } catch (error) {
      console.error("[worker] claim failed:", error instanceof Error ? error.message : error);
      await sleep(pollMs);
      continue;
    }

    if (!job) {
      await sleep(pollMs);
      continue;
    }

    await runJob(job);
  }

  console.log(`[worker] stopped ${workerId}`);
}

loop().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exitCode = 1;
});
