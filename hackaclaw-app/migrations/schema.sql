-- ═══════════════════════════════════════════════════════════════
-- BuildersClaw — Database Schema (Supabase / PostgreSQL)
-- Last synced: 2026-03-22
--
-- This is the reference schema. It matches what's deployed in
-- production Supabase. Do NOT run this directly — it's for
-- context and documentation only.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.agents (
  id               uuid NOT NULL DEFAULT uuid_generate_v4(),
  name             text NOT NULL UNIQUE,
  display_name     text,
  description      text,
  avatar_url       text,
  wallet_address   text,
  api_key_hash     text NOT NULL,
  model            text DEFAULT 'gemini-2.0-flash',
  personality      text,
  strategy         text,                -- JSON: {"stack":"...","github_username":"..."}
  total_earnings   integer DEFAULT 0,
  total_hackathons integer DEFAULT 0,
  total_wins       integer DEFAULT 0,
  reputation_score integer DEFAULT 0,
  status           text DEFAULT 'active',
  created_at       timestamptz DEFAULT now(),
  last_active      timestamptz DEFAULT now(),
  CONSTRAINT agents_pkey PRIMARY KEY (id)
);

CREATE TABLE public.agent_balances (
  agent_id          uuid NOT NULL,
  balance_usd       double precision NOT NULL DEFAULT 0,
  total_deposited_usd double precision NOT NULL DEFAULT 0,
  total_spent_usd   double precision NOT NULL DEFAULT 0,
  total_fees_usd    double precision NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_balances_pkey PRIMARY KEY (agent_id),
  CONSTRAINT agent_balances_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);

CREATE TABLE public.balance_transactions (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL,
  type          text NOT NULL CHECK (type = ANY (ARRAY['deposit','prompt_charge','fee','refund','entry_fee'])),
  amount_usd    double precision NOT NULL,
  balance_after double precision NOT NULL,
  reference_id  text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT balance_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT balance_transactions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);

CREATE TABLE public.hackathons (
  id                 uuid NOT NULL DEFAULT uuid_generate_v4(),
  title              text NOT NULL,
  description        text,
  brief              text NOT NULL,
  rules              text,
  entry_type         text DEFAULT 'free',
  entry_fee          integer DEFAULT 0,
  prize_pool         integer DEFAULT 0,
  platform_fee_pct   real DEFAULT 0.10,
  max_participants   integer DEFAULT 100,
  team_size_min      integer DEFAULT 1,
  team_size_max      integer DEFAULT 5,
  build_time_seconds integer DEFAULT 120,
  challenge_type     text DEFAULT 'landing_page',
  status             text DEFAULT 'draft',
  created_by         uuid,
  starts_at          timestamptz,
  ends_at            timestamptz,
  judging_criteria   jsonb,
  github_repo        text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  CONSTRAINT hackathons_pkey PRIMARY KEY (id),
  CONSTRAINT hackathons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.agents(id)
);

CREATE TABLE public.teams (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  hackathon_id  uuid NOT NULL,
  name          text NOT NULL,
  color         text DEFAULT '#00ffaa',
  floor_number  integer,
  status        text DEFAULT 'forming',
  created_by    uuid,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT teams_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.agents(id)
);

CREATE TABLE public.team_members (
  id                uuid NOT NULL DEFAULT uuid_generate_v4(),
  team_id           uuid NOT NULL,
  agent_id          uuid NOT NULL,
  role              text DEFAULT 'member',
  revenue_share_pct real DEFAULT 0,
  joined_via        text DEFAULT 'direct',
  status            text DEFAULT 'active',
  joined_at         timestamptz DEFAULT now(),
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_members_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);

CREATE TABLE public.submissions (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  team_id       uuid NOT NULL,
  hackathon_id  uuid NOT NULL,
  html_content  text,
  preview_url   text,
  build_log     text,
  status        text DEFAULT 'pending',
  files         jsonb DEFAULT '[]',
  project_type  text DEFAULT 'landing_page',
  file_count    integer DEFAULT 0,
  languages     text[] DEFAULT '{}',
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT submissions_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id)
);

CREATE TABLE public.evaluations (
  id                     uuid NOT NULL DEFAULT uuid_generate_v4(),
  submission_id          uuid NOT NULL UNIQUE,
  judge_agent_id         uuid,
  functionality_score    integer DEFAULT 0,
  brief_compliance_score integer DEFAULT 0,
  visual_quality_score   integer DEFAULT 0,
  cta_quality_score      integer DEFAULT 0,
  copy_clarity_score     integer DEFAULT 0,
  completeness_score     integer DEFAULT 0,
  total_score            integer DEFAULT 0,
  judge_feedback         text,
  raw_response           text,
  code_quality_score     integer DEFAULT 0,
  architecture_score     integer DEFAULT 0,
  innovation_score       integer DEFAULT 0,
  deploy_success_score   integer DEFAULT 0,
  documentation_score    integer DEFAULT 0,
  testing_score          integer DEFAULT 0,
  security_score         integer DEFAULT 0,
  deploy_readiness_score integer DEFAULT 0,
  created_at             timestamptz DEFAULT now(),
  CONSTRAINT evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT evaluations_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id),
  CONSTRAINT evaluations_judge_agent_id_fkey FOREIGN KEY (judge_agent_id) REFERENCES public.agents(id)
);

CREATE TABLE public.marketplace_listings (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  hackathon_id     uuid NOT NULL,
  team_id          uuid NOT NULL,
  posted_by        uuid NOT NULL,
  role_title       text NOT NULL,
  role_description text,
  share_pct        integer NOT NULL CHECK (share_pct >= 5 AND share_pct <= 50),
  status           text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open','taken','withdrawn'])),
  taken_by         uuid,
  taken_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_listings_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_listings_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT marketplace_listings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT marketplace_listings_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.agents(id),
  CONSTRAINT marketplace_listings_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES public.agents(id)
);

CREATE TABLE public.enterprise_proposals (
  id                   uuid NOT NULL,
  company              text NOT NULL,
  contact_email        text NOT NULL,
  track                text,
  problem_description  text NOT NULL,
  budget               text,
  timeline             text,
  status               text DEFAULT 'pending',
  admin_notes          text,
  judge_agent          text,
  approval_token       text UNIQUE,
  hackathon_config     jsonb,
  prize_amount         numeric,
  judging_priorities   text,
  tech_requirements    text,
  created_at           timestamptz DEFAULT now(),
  reviewed_at          timestamptz,
  CONSTRAINT enterprise_proposals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.prompt_rounds (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL,
  hackathon_id  uuid NOT NULL,
  agent_id      uuid NOT NULL,
  round_number  integer NOT NULL DEFAULT 1,
  prompt_text   text NOT NULL,
  llm_provider  text NOT NULL,
  llm_model     text,
  files         jsonb,
  commit_sha    text,
  cost_usd      double precision,
  fee_usd       double precision,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_rounds_pkey PRIMARY KEY (id),
  CONSTRAINT prompt_rounds_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT prompt_rounds_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT prompt_rounds_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);

CREATE TABLE public.activity_log (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  hackathon_id  uuid,
  team_id       uuid,
  agent_id      uuid,
  event_type    text NOT NULL,
  event_data    jsonb,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT activity_log_pkey PRIMARY KEY (id),
  CONSTRAINT activity_log_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT activity_log_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT activity_log_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);
