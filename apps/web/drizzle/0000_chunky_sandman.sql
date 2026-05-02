CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon_id" uuid,
	"team_id" uuid,
	"agent_id" uuid,
	"event_type" text NOT NULL,
	"event_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_balances" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"balance_usd" double precision DEFAULT 0 NOT NULL,
	"total_deposited_usd" double precision DEFAULT 0 NOT NULL,
	"total_spent_usd" double precision DEFAULT 0 NOT NULL,
	"total_fees_usd" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_balance_non_negative" CHECK ("agent_balances"."balance_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_identity_snapshots" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"identity_registry" text NOT NULL,
	"identity_agent_id" text NOT NULL,
	"identity_chain_id" integer NOT NULL,
	"identity_agent_uri" text,
	"identity_wallet" text,
	"identity_owner_wallet" text,
	"registration_valid" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_reputation_snapshots" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"identity_registry" text NOT NULL,
	"identity_agent_id" text NOT NULL,
	"trusted_client_count" integer DEFAULT 0 NOT NULL,
	"trusted_feedback_count" integer DEFAULT 0 NOT NULL,
	"trusted_summary_value" text,
	"trusted_summary_decimals" integer,
	"raw_client_count" integer DEFAULT 0 NOT NULL,
	"raw_feedback_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_webhooks" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"webhook_url" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"description" text,
	"avatar_url" text,
	"wallet_address" text,
	"api_key_hash" text NOT NULL,
	"model" text DEFAULT 'gemini-2.0-flash' NOT NULL,
	"personality" text,
	"strategy" text,
	"total_earnings" integer DEFAULT 0 NOT NULL,
	"total_hackathons" integer DEFAULT 0 NOT NULL,
	"total_wins" integer DEFAULT 0 NOT NULL,
	"reputation_score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"identity_registry" text,
	"identity_agent_id" text,
	"identity_chain_id" integer,
	"identity_agent_uri" text,
	"identity_wallet" text,
	"identity_owner_wallet" text,
	"identity_source" text,
	"identity_link_status" text,
	"identity_verified_at" timestamp with time zone,
	"marketplace_reputation_score" integer DEFAULT 0 NOT NULL,
	"marketplace_completed_roles" integer DEFAULT 0 NOT NULL,
	"marketplace_successful_roles" integer DEFAULT 0 NOT NULL,
	"marketplace_failed_roles" integer DEFAULT 0 NOT NULL,
	"marketplace_review_approvals" integer DEFAULT 0 NOT NULL,
	"marketplace_no_show_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_name_unique" UNIQUE("name"),
	CONSTRAINT "ck_api_key_hash_valid" CHECK (length("agents"."api_key_hash") = 64),
	CONSTRAINT "agents_identity_source_check" CHECK ("agents"."identity_source" is null or "agents"."identity_source" in ('external', 'buildersclaw')),
	CONSTRAINT "agents_identity_link_status_check" CHECK ("agents"."identity_link_status" is null or "agents"."identity_link_status" in ('unlinked', 'linked', 'stale', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_usd" double precision NOT NULL,
	"balance_after" double precision NOT NULL,
	"reference_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_transactions_type_check" CHECK ("balance_transactions"."type" in ('deposit', 'prompt_charge', 'fee', 'refund', 'entry_fee'))
);
--> statement-breakpoint
CREATE TABLE "deployment_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"url_checked" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"runtime_score" integer,
	"summary" text,
	"raw_evidence" jsonb,
	"warnings" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_checks_submission_id_unique" UNIQUE("submission_id"),
	CONSTRAINT "deployment_checks_status_check" CHECK ("deployment_checks"."status" in ('pending', 'success', 'failed', 'timeout'))
);
--> statement-breakpoint
CREATE TABLE "enterprise_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"contact_email" text NOT NULL,
	"track" text,
	"problem_description" text NOT NULL,
	"budget" text,
	"timeline" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"judge_agent" text,
	"approval_token" text,
	"hackathon_config" jsonb,
	"prize_amount" numeric,
	"judging_priorities" text,
	"tech_requirements" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "enterprise_proposals_approval_token_unique" UNIQUE("approval_token")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"judge_agent_id" uuid,
	"functionality_score" integer DEFAULT 0 NOT NULL,
	"brief_compliance_score" integer DEFAULT 0 NOT NULL,
	"visual_quality_score" integer DEFAULT 0 NOT NULL,
	"cta_quality_score" integer DEFAULT 0 NOT NULL,
	"copy_clarity_score" integer DEFAULT 0 NOT NULL,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"judge_feedback" text,
	"raw_response" text,
	"code_quality_score" integer DEFAULT 0 NOT NULL,
	"architecture_score" integer DEFAULT 0 NOT NULL,
	"innovation_score" integer DEFAULT 0 NOT NULL,
	"deploy_success_score" integer DEFAULT 0 NOT NULL,
	"documentation_score" integer DEFAULT 0 NOT NULL,
	"testing_score" integer DEFAULT 0 NOT NULL,
	"security_score" integer DEFAULT 0 NOT NULL,
	"deploy_readiness_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "finalization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"job_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"winner_team_id" uuid NOT NULL,
	"winner_agent_id" uuid,
	"winners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"scores" jsonb,
	"tx_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finalization_runs_status_check" CHECK ("finalization_runs"."status" in ('queued', 'broadcasting', 'polling_receipt', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "hackathons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"brief" text NOT NULL,
	"rules" text,
	"entry_type" text DEFAULT 'free' NOT NULL,
	"entry_fee" integer DEFAULT 0 NOT NULL,
	"prize_pool" integer DEFAULT 0 NOT NULL,
	"platform_fee_pct" real DEFAULT 0.1 NOT NULL,
	"max_participants" integer DEFAULT 100 NOT NULL,
	"team_size_min" integer DEFAULT 1 NOT NULL,
	"team_size_max" integer DEFAULT 5 NOT NULL,
	"build_time_seconds" integer DEFAULT 120 NOT NULL,
	"challenge_type" text DEFAULT 'landing_page' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"judging_criteria" jsonb,
	"github_repo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lock_expires_at" timestamp with time zone,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "judging_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"job_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judging_runs_status_check" CHECK ("judging_runs"."status" in ('queued', 'running', 'waiting_genlayer', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"posted_by" uuid NOT NULL,
	"role_title" text NOT NULL,
	"role_type" text DEFAULT 'builder' NOT NULL,
	"role_description" text,
	"share_pct" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"taken_by" uuid,
	"taken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listings_share_pct_check" CHECK ("marketplace_listings"."share_pct" >= 5 and "marketplace_listings"."share_pct" <= 50),
	CONSTRAINT "marketplace_listings_status_check" CHECK ("marketplace_listings"."status" in ('open', 'taken', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "marketplace_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"offered_by" uuid NOT NULL,
	"offered_share_pct" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_offers_share_pct_check" CHECK ("marketplace_offers"."offered_share_pct" >= 5 and "marketplace_offers"."offered_share_pct" <= 60),
	CONSTRAINT "marketplace_offers_status_check" CHECK ("marketplace_offers"."status" in ('pending', 'accepted', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "peer_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_agent_id" uuid NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"total_score" integer,
	"feedback" text,
	"warnings" jsonb,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "peer_judgments_status_check" CHECK ("peer_judgments"."status" in ('assigned', 'submitted', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "prompt_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"prompt_text" text NOT NULL,
	"llm_provider" text NOT NULL,
	"llm_model" text,
	"files" jsonb,
	"commit_sha" text,
	"cost_usd" double precision,
	"fee_usd" double precision,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"ip_address" text,
	"agent_id" text,
	"endpoint" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"html_content" text,
	"preview_url" text,
	"build_log" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_type" text DEFAULT 'landing_page' NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"sender_type" text DEFAULT 'agent' NOT NULL,
	"sender_id" uuid,
	"sender_name" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_chat_sender_type_check" CHECK ("team_chat"."sender_type" in ('agent', 'system', 'telegram')),
	CONSTRAINT "team_chat_message_type_check" CHECK ("team_chat"."message_type" in ('text', 'push', 'feedback', 'approval', 'submission', 'system'))
);
--> statement-breakpoint
CREATE TABLE "team_iterations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"push_number" integer DEFAULT 1 NOT NULL,
	"commit_sha" text,
	"commit_message" text,
	"pushed_by" uuid NOT NULL,
	"repo_url" text,
	"feedback_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"feedback_text" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_iterations_feedback_status_check" CHECK ("team_iterations"."feedback_status" in ('pending', 'approved', 'changes_requested', 'no_reviewer'))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"revenue_share_pct" real DEFAULT 0 NOT NULL,
	"joined_via" text DEFAULT 'direct' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_share_bounds" CHECK ("team_members"."revenue_share_pct" >= 0 and "team_members"."revenue_share_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hackathon_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#00ffaa' NOT NULL,
	"floor_number" integer,
	"status" text DEFAULT 'forming' NOT NULL,
	"telegram_chat_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_reputation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"kind" text DEFAULT 'buildersclaw' NOT NULL,
	"label" text,
	"weight" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_reputation_sources_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"event" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload_summary" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity_snapshots" ADD CONSTRAINT "agent_identity_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reputation_snapshots" ADD CONSTRAINT "agent_reputation_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_webhooks" ADD CONSTRAINT "agent_webhooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_checks" ADD CONSTRAINT "deployment_checks_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_judge_agent_id_agents_id_fk" FOREIGN KEY ("judge_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_winner_agent_id_agents_id_fk" FOREIGN KEY ("winner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_runs" ADD CONSTRAINT "judging_runs_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_runs" ADD CONSTRAINT "judging_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_posted_by_agents_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_taken_by_agents_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_offers" ADD CONSTRAINT "marketplace_offers_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_offers" ADD CONSTRAINT "marketplace_offers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_offers" ADD CONSTRAINT "marketplace_offers_offered_by_agents_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_judgments" ADD CONSTRAINT "peer_judgments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_judgments" ADD CONSTRAINT "peer_judgments_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_rounds" ADD CONSTRAINT "prompt_rounds_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_rounds" ADD CONSTRAINT "prompt_rounds_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_rounds" ADD CONSTRAINT "prompt_rounds_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat" ADD CONSTRAINT "team_chat_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat" ADD CONSTRAINT "team_chat_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat" ADD CONSTRAINT "team_chat_sender_id_agents_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_iterations" ADD CONSTRAINT "team_iterations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_iterations" ADD CONSTRAINT "team_iterations_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_iterations" ADD CONSTRAINT "team_iterations_pushed_by_agents_id_fk" FOREIGN KEY ("pushed_by") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_iterations" ADD CONSTRAINT "team_iterations_reviewed_by_agents_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_hackathon_id_hackathons_id_fk" FOREIGN KEY ("hackathon_id") REFERENCES "public"."hackathons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_log_event_data_gin" ON "activity_log" USING gin ("event_data");--> statement-breakpoint
CREATE INDEX "idx_activity_log_hackathon" ON "activity_log" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "idx_agent_identity_snapshots_registry_agent" ON "agent_identity_snapshots" USING btree ("identity_registry","identity_agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_reputation_snapshots_last_synced" ON "agent_reputation_snapshots" USING btree ("last_synced_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_webhooks_active" ON "agent_webhooks" USING btree ("active") WHERE "agent_webhooks"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agents_identity_registry_agent_id" ON "agents" USING btree ("identity_registry","identity_agent_id") WHERE "agents"."identity_registry" is not null and "agents"."identity_agent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_agents_marketplace_reputation_score" ON "agents" USING btree ("marketplace_reputation_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agents_identity_wallet" ON "agents" USING btree ("identity_wallet") WHERE "agents"."identity_wallet" is not null;--> statement-breakpoint
CREATE INDEX "idx_balance_tx_agent" ON "balance_transactions" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_balance_tx_type" ON "balance_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_balance_tx_ref" ON "balance_transactions" USING btree ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_balance_tx_ref_unique" ON "balance_transactions" USING btree ("reference_id") WHERE "balance_transactions"."reference_id" is not null and "balance_transactions"."type" = 'deposit';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_finalization_runs_one_active" ON "finalization_runs" USING btree ("hackathon_id") WHERE "finalization_runs"."status" in ('queued', 'broadcasting', 'polling_receipt');--> statement-breakpoint
CREATE INDEX "idx_finalization_runs_hackathon_status" ON "finalization_runs" USING btree ("hackathon_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_jobs_due" ON "jobs" USING btree ("status","run_at","created_at") WHERE "jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "idx_jobs_type_status" ON "jobs" USING btree ("type","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_judging_runs_one_active" ON "judging_runs" USING btree ("hackathon_id") WHERE "judging_runs"."status" in ('queued', 'running', 'waiting_genlayer');--> statement-breakpoint
CREATE INDEX "idx_judging_runs_hackathon_status" ON "judging_runs" USING btree ("hackathon_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_marketplace_team_status" ON "marketplace_listings" USING btree ("team_id","status") WHERE "marketplace_listings"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_marketplace_hackathon" ON "marketplace_listings" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "idx_mo_listing" ON "marketplace_offers" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_mo_offered_by" ON "marketplace_offers" USING btree ("offered_by");--> statement-breakpoint
CREATE INDEX "idx_mo_team" ON "marketplace_offers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_mo_status" ON "marketplace_offers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_judgments_submission_reviewer_unique" ON "peer_judgments" USING btree ("submission_id","reviewer_agent_id");--> statement-breakpoint
CREATE INDEX "idx_prompt_rounds_team_hackathon" ON "prompt_rounds" USING btree ("team_id","hackathon_id","round_number");--> statement-breakpoint
CREATE INDEX "idx_audit_log_created" ON "security_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_log_type_created" ON "security_audit_log" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_log_agent" ON "security_audit_log" USING btree ("agent_id","created_at" DESC NULLS LAST) WHERE "security_audit_log"."agent_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_submissions_hackathon" ON "submissions" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_team" ON "submissions" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_chat_team_time" ON "team_chat" USING btree ("team_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_team_chat_hackathon" ON "team_chat" USING btree ("hackathon_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_team_chat_team_since" ON "team_chat" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_team_iterations_team" ON "team_iterations" USING btree ("team_id","push_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_team_iterations_hackathon" ON "team_iterations" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_agent" ON "team_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_team" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_teams_hackathon" ON "teams" USING btree ("hackathon_id");--> statement-breakpoint
CREATE INDEX "idx_trusted_reputation_sources_active" ON "trusted_reputation_sources" USING btree ("active","wallet_address");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_agent" ON "webhook_deliveries" USING btree ("agent_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_status" ON "webhook_deliveries" USING btree ("status") WHERE "webhook_deliveries"."status" = 'failed';