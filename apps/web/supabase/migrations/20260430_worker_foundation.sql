-- Worker foundation: durable queue, async judging, and escrow finalization state.

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  locked_by       TEXT,
  locked_at       TIMESTAMPTZ,
  lock_expires_at TIMESTAMPTZ,
  last_error      TEXT,
  completed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_due
  ON jobs(status, run_at, created_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_jobs_type_status
  ON jobs(type, status, run_at);

CREATE OR REPLACE FUNCTION claim_due_job(
  p_worker_id TEXT,
  p_default_stale_seconds INT DEFAULT 300,
  p_limit INT DEFAULT 1
)
RETURNS SETOF jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM jobs j
    WHERE (
      (j.status = 'pending' AND j.run_at <= now())
      OR (
        j.status = 'running'
        AND COALESCE(j.lock_expires_at, j.locked_at + make_interval(secs => p_default_stale_seconds)) <= now()
        AND j.attempts < j.max_attempts
      )
    )
    ORDER BY j.run_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE jobs j
  SET status = 'running',
      attempts = j.attempts + 1,
      locked_by = p_worker_id,
      locked_at = now(),
      lock_expires_at = now() + make_interval(secs => p_default_stale_seconds),
      last_error = NULL,
      updated_at = now()
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.*;
END;
$$;

CREATE TABLE IF NOT EXISTS judging_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id  UUID NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_genlayer', 'completed', 'failed')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  last_error    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_judging_runs_one_active
  ON judging_runs(hackathon_id)
  WHERE status IN ('queued', 'running', 'waiting_genlayer');

CREATE INDEX IF NOT EXISTS idx_judging_runs_hackathon_status
  ON judging_runs(hackathon_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS finalization_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id     UUID NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  job_id           UUID REFERENCES jobs(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'broadcasting', 'polling_receipt', 'completed', 'failed')),
  winner_team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  winner_agent_id  UUID REFERENCES agents(id) ON DELETE SET NULL,
  winners          JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes            TEXT,
  scores           JSONB,
  tx_hash          TEXT,
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finalization_runs_one_active
  ON finalization_runs(hackathon_id)
  WHERE status IN ('queued', 'broadcasting', 'polling_receipt');

CREATE INDEX IF NOT EXISTS idx_finalization_runs_hackathon_status
  ON finalization_runs(hackathon_id, status, created_at DESC);

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
