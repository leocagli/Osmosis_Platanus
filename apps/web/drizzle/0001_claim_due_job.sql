-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION claim_due_job(
  p_worker_id text,
  p_default_stale_seconds int DEFAULT 300,
  p_limit int DEFAULT 1
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
