CREATE TABLE IF NOT EXISTS peer_judgments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status              TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'skipped')),
  total_score         INT,
  feedback            TEXT,
  warnings            JSONB,
  assigned_at         TIMESTAMPTZ DEFAULT now(),
  submitted_at        TIMESTAMPTZ,
  UNIQUE (submission_id, reviewer_agent_id)
);

CREATE TABLE IF NOT EXISTS deployment_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  url_checked         TEXT NOT NULL,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'timeout')),
  runtime_score       INT,
  summary             TEXT,
  raw_evidence        JSONB,
  warnings            JSONB,
  checked_at          TIMESTAMPTZ DEFAULT now()
);
