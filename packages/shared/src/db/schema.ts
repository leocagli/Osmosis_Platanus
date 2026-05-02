import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestampString = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export type JsonRecord = Record<string, unknown>;
export type JsonArray = unknown[];

export type AgentStatus = "active" | "inactive" | "suspended";
export type BalanceTransactionType = "deposit" | "prompt_charge" | "fee" | "refund" | "entry_fee";
export type HackathonEntryType = "free" | "paid";
export type HackathonStatus = "draft" | "open" | "in_progress" | "closed" | "completed" | "finalized";
export type TeamStatus = "forming" | "ready" | "building" | "submitted" | "judged";
export type TeamMemberRole = "leader" | "member" | "hired" | string;
export type MarketplaceListingStatus = "open" | "taken" | "withdrawn";
export type SubmissionStatus = "pending" | "building" | "completed" | "failed";
export type TeamChatSenderType = "agent" | "system" | "telegram";
export type TeamChatMessageType = "text" | "push" | "feedback" | "approval" | "submission" | "system";
export type TeamIterationFeedbackStatus = "pending" | "approved" | "changes_requested" | "no_reviewer";
export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JudgingRunStatus = "queued" | "running" | "waiting_genlayer" | "completed" | "failed";
export type FinalizationRunStatus = "queued" | "broadcasting" | "polling_receipt" | "completed" | "failed";
export type PeerJudgmentStatus = "assigned" | "submitted" | "skipped";
export type DeploymentCheckStatus = "pending" | "success" | "failed" | "timeout";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    displayName: text("display_name"),
    description: text("description"),
    avatarUrl: text("avatar_url"),
    walletAddress: text("wallet_address"),
    apiKeyHash: text("api_key_hash").notNull(),
    model: text("model").notNull().default("gemini-2.0-flash"),
    personality: text("personality"),
    strategy: text("strategy"),
    totalEarnings: integer("total_earnings").notNull().default(0),
    totalHackathons: integer("total_hackathons").notNull().default(0),
    totalWins: integer("total_wins").notNull().default(0),
    reputationScore: integer("reputation_score").notNull().default(0),
    status: text("status").$type<AgentStatus | string>().notNull().default("active"),
    identityRegistry: text("identity_registry"),
    identityAgentId: text("identity_agent_id"),
    identityChainId: integer("identity_chain_id"),
    identityAgentUri: text("identity_agent_uri"),
    identityWallet: text("identity_wallet"),
    identityOwnerWallet: text("identity_owner_wallet"),
    identitySource: text("identity_source"),
    identityLinkStatus: text("identity_link_status"),
    identityVerifiedAt: timestampString("identity_verified_at"),
    marketplaceReputationScore: integer("marketplace_reputation_score").notNull().default(0),
    marketplaceCompletedRoles: integer("marketplace_completed_roles").notNull().default(0),
    marketplaceSuccessfulRoles: integer("marketplace_successful_roles").notNull().default(0),
    marketplaceFailedRoles: integer("marketplace_failed_roles").notNull().default(0),
    marketplaceReviewApprovals: integer("marketplace_review_approvals").notNull().default(0),
    marketplaceNoShowCount: integer("marketplace_no_show_count").notNull().default(0),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    lastActive: timestampString("last_active").notNull().defaultNow(),
  },
  (table) => [
    check("ck_api_key_hash_valid", sql`length(${table.apiKeyHash}) = 64`),
    check("agents_identity_source_check", sql`${table.identitySource} is null or ${table.identitySource} in ('external', 'buildersclaw')`),
    check("agents_identity_link_status_check", sql`${table.identityLinkStatus} is null or ${table.identityLinkStatus} in ('unlinked', 'linked', 'stale', 'invalid')`),
    uniqueIndex("idx_agents_identity_registry_agent_id")
      .on(table.identityRegistry, table.identityAgentId)
      .where(sql`${table.identityRegistry} is not null and ${table.identityAgentId} is not null`),
    index("idx_agents_marketplace_reputation_score").on(table.marketplaceReputationScore.desc()),
    index("idx_agents_identity_wallet").on(table.identityWallet).where(sql`${table.identityWallet} is not null`),
  ],
);

export const agentBalances = pgTable(
  "agent_balances",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    balanceUsd: doublePrecision("balance_usd").notNull().default(0),
    totalDepositedUsd: doublePrecision("total_deposited_usd").notNull().default(0),
    totalSpentUsd: doublePrecision("total_spent_usd").notNull().default(0),
    totalFeesUsd: doublePrecision("total_fees_usd").notNull().default(0),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [check("ck_balance_non_negative", sql`${table.balanceUsd} >= 0`)],
);

export const balanceTransactions = pgTable(
  "balance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: text("type").$type<BalanceTransactionType>().notNull(),
    amountUsd: doublePrecision("amount_usd").notNull(),
    balanceAfter: doublePrecision("balance_after").notNull(),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata").$type<JsonRecord | null>(),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("balance_transactions_type_check", sql`${table.type} in ('deposit', 'prompt_charge', 'fee', 'refund', 'entry_fee')`),
    index("idx_balance_tx_agent").on(table.agentId, table.createdAt.desc()),
    index("idx_balance_tx_type").on(table.type),
    index("idx_balance_tx_ref").on(table.referenceId),
    uniqueIndex("idx_balance_tx_ref_unique")
      .on(table.referenceId)
      .where(sql`${table.referenceId} is not null and ${table.type} = 'deposit'`),
  ],
);

export const hackathons = pgTable("hackathons", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  brief: text("brief").notNull(),
  rules: text("rules"),
  entryType: text("entry_type").$type<HackathonEntryType | string>().notNull().default("free"),
  entryFee: integer("entry_fee").notNull().default(0),
  prizePool: integer("prize_pool").notNull().default(0),
  platformFeePct: real("platform_fee_pct").notNull().default(0.1),
  maxParticipants: integer("max_participants").notNull().default(100),
  teamSizeMin: integer("team_size_min").notNull().default(1),
  teamSizeMax: integer("team_size_max").notNull().default(5),
  buildTimeSeconds: integer("build_time_seconds").notNull().default(120),
  challengeType: text("challenge_type").notNull().default("landing_page"),
  status: text("status").$type<HackathonStatus | string>().notNull().default("draft"),
  createdBy: uuid("created_by").references(() => agents.id, { onDelete: "set null" }),
  startsAt: timestampString("starts_at"),
  endsAt: timestampString("ends_at"),
  judgingCriteria: jsonb("judging_criteria").$type<JsonRecord | string | null>(),
  githubRepo: text("github_repo"),
  createdAt: timestampString("created_at").notNull().defaultNow(),
  updatedAt: timestampString("updated_at").notNull().defaultNow(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#00ffaa"),
    floorNumber: integer("floor_number"),
    status: text("status").$type<TeamStatus | string>().notNull().default("forming"),
    telegramChatId: text("telegram_chat_id"),
    createdBy: uuid("created_by").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_teams_hackathon").on(table.hackathonId)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").$type<TeamMemberRole>().notNull().default("member"),
    revenueSharePct: real("revenue_share_pct").notNull().default(0),
    joinedVia: text("joined_via").notNull().default("direct"),
    status: text("status").notNull().default("active"),
    joinedAt: timestampString("joined_at").notNull().defaultNow(),
  },
  (table) => [
    check("ck_share_bounds", sql`${table.revenueSharePct} >= 0 and ${table.revenueSharePct} <= 100`),
    index("idx_team_members_agent").on(table.agentId),
    index("idx_team_members_team").on(table.teamId),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    htmlContent: text("html_content"),
    previewUrl: text("preview_url"),
    buildLog: text("build_log"),
    status: text("status").$type<SubmissionStatus | string>().notNull().default("pending"),
    files: jsonb("files").$type<JsonArray>().notNull().default(sql`'[]'::jsonb`),
    projectType: text("project_type").notNull().default("landing_page"),
    fileCount: integer("file_count").notNull().default(0),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    startedAt: timestampString("started_at"),
    completedAt: timestampString("completed_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_submissions_hackathon").on(table.hackathonId), index("idx_submissions_team").on(table.teamId)],
);

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .unique()
    .references(() => submissions.id, { onDelete: "cascade" }),
  judgeAgentId: uuid("judge_agent_id").references(() => agents.id, { onDelete: "set null" }),
  functionalityScore: integer("functionality_score").notNull().default(0),
  briefComplianceScore: integer("brief_compliance_score").notNull().default(0),
  visualQualityScore: integer("visual_quality_score").notNull().default(0),
  ctaQualityScore: integer("cta_quality_score").notNull().default(0),
  copyClarityScore: integer("copy_clarity_score").notNull().default(0),
  completenessScore: integer("completeness_score").notNull().default(0),
  totalScore: integer("total_score").notNull().default(0),
  judgeFeedback: text("judge_feedback"),
  rawResponse: text("raw_response"),
  codeQualityScore: integer("code_quality_score").notNull().default(0),
  architectureScore: integer("architecture_score").notNull().default(0),
  innovationScore: integer("innovation_score").notNull().default(0),
  deploySuccessScore: integer("deploy_success_score").notNull().default(0),
  documentationScore: integer("documentation_score").notNull().default(0),
  testingScore: integer("testing_score").notNull().default(0),
  securityScore: integer("security_score").notNull().default(0),
  deployReadinessScore: integer("deploy_readiness_score").notNull().default(0),
  createdAt: timestampString("created_at").notNull().defaultNow(),
});

export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    postedBy: uuid("posted_by")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roleTitle: text("role_title").notNull(),
    roleType: text("role_type").notNull().default("builder"),
    roleDescription: text("role_description"),
    sharePct: integer("share_pct").notNull(),
    status: text("status").$type<MarketplaceListingStatus>().notNull().default("open"),
    takenBy: uuid("taken_by").references(() => agents.id, { onDelete: "set null" }),
    takenAt: timestampString("taken_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("marketplace_listings_share_pct_check", sql`${table.sharePct} >= 5 and ${table.sharePct} <= 50`),
    check("marketplace_listings_status_check", sql`${table.status} in ('open', 'taken', 'withdrawn')`),
    index("idx_marketplace_team_status").on(table.teamId, table.status).where(sql`${table.status} = 'open'`),
    index("idx_marketplace_hackathon").on(table.hackathonId),
  ],
);

export const marketplaceOffers = pgTable(
  "marketplace_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    offeredBy: uuid("offered_by")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    offeredSharePct: integer("offered_share_pct").notNull(),
    role: text("role").notNull().default("member"),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("marketplace_offers_share_pct_check", sql`${table.offeredSharePct} >= 5 and ${table.offeredSharePct} <= 60`),
    check("marketplace_offers_status_check", sql`${table.status} in ('pending', 'accepted', 'rejected', 'expired')`),
    index("idx_mo_listing").on(table.listingId),
    index("idx_mo_offered_by").on(table.offeredBy),
    index("idx_mo_team").on(table.teamId),
    index("idx_mo_status").on(table.status),
  ],
);

export const enterpriseProposals = pgTable("enterprise_proposals", {
  id: uuid("id").primaryKey(),
  company: text("company").notNull(),
  contactEmail: text("contact_email").notNull(),
  track: text("track"),
  problemDescription: text("problem_description").notNull(),
  budget: text("budget"),
  timeline: text("timeline"),
  status: text("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  judgeAgent: text("judge_agent"),
  approvalToken: text("approval_token").unique(),
  hackathonConfig: jsonb("hackathon_config").$type<JsonRecord | null>(),
  prizeAmount: numeric("prize_amount"),
  judgingPriorities: text("judging_priorities"),
  techRequirements: text("tech_requirements"),
  createdAt: timestampString("created_at").notNull().defaultNow(),
  reviewedAt: timestampString("reviewed_at"),
});

export const promptRounds = pgTable(
  "prompt_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull().default(1),
    promptText: text("prompt_text").notNull(),
    llmProvider: text("llm_provider").notNull(),
    llmModel: text("llm_model"),
    files: jsonb("files").$type<JsonRecord | JsonArray | null>(),
    commitSha: text("commit_sha"),
    costUsd: doublePrecision("cost_usd"),
    feeUsd: doublePrecision("fee_usd"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_prompt_rounds_team_hackathon").on(table.teamId, table.hackathonId, table.roundNumber)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathonId: uuid("hackathon_id").references(() => hackathons.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    eventData: jsonb("event_data").$type<JsonRecord | null>(),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_activity_log_event_data_gin").using("gin", table.eventData), index("idx_activity_log_hackathon").on(table.hackathonId)],
);

export const securityAuditLog = pgTable(
  "security_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    agentId: text("agent_id"),
    endpoint: text("endpoint"),
    details: jsonb("details").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_log_created").on(table.createdAt.desc()),
    index("idx_audit_log_type_created").on(table.eventType, table.createdAt.desc()),
    index("idx_audit_log_agent").on(table.agentId, table.createdAt.desc()).where(sql`${table.agentId} is not null`),
  ],
);

export const teamIterations = pgTable(
  "team_iterations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    pushNumber: integer("push_number").notNull().default(1),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    pushedBy: uuid("pushed_by")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    repoUrl: text("repo_url"),
    feedbackStatus: text("feedback_status").$type<TeamIterationFeedbackStatus>().notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => agents.id, { onDelete: "set null" }),
    feedbackText: text("feedback_text"),
    reviewedAt: timestampString("reviewed_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("team_iterations_feedback_status_check", sql`${table.feedbackStatus} in ('pending', 'approved', 'changes_requested', 'no_reviewer')`),
    index("idx_team_iterations_team").on(table.teamId, table.pushNumber.desc()),
    index("idx_team_iterations_hackathon").on(table.hackathonId),
  ],
);

export const teamChat = pgTable(
  "team_chat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    senderType: text("sender_type").$type<TeamChatSenderType>().notNull().default("agent"),
    senderId: uuid("sender_id").references(() => agents.id, { onDelete: "set null" }),
    senderName: text("sender_name").notNull(),
    messageType: text("message_type").$type<TeamChatMessageType>().notNull().default("text"),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<JsonRecord | null>(),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    createdAt: timestampString("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("team_chat_sender_type_check", sql`${table.senderType} in ('agent', 'system', 'telegram')`),
    check("team_chat_message_type_check", sql`${table.messageType} in ('text', 'push', 'feedback', 'approval', 'submission', 'system')`),
    index("idx_team_chat_team_time").on(table.teamId, table.createdAt.desc()),
    index("idx_team_chat_hackathon").on(table.hackathonId, table.createdAt.desc()),
    index("idx_team_chat_team_since").on(table.teamId, table.createdAt.asc()),
  ],
);

export const agentWebhooks = pgTable(
  "agent_webhooks",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    webhookUrl: text("webhook_url").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveryAt: timestampString("last_delivery_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [index("idx_agent_webhooks_active").on(table.active).where(sql`${table.active} = true`)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: uuid("delivery_id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    status: text("status").notNull().default("pending"),
    payloadSummary: jsonb("payload_summary").$type<JsonRecord | null>(),
    payload: jsonb("payload").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestampString("next_attempt_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_webhook_deliveries_agent").on(table.agentId, table.updatedAt.desc()),
    index("idx_webhook_deliveries_status").on(table.status).where(sql`${table.status} = 'failed'`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    payload: jsonb("payload").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
    runAt: timestampString("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedBy: text("locked_by"),
    lockedAt: timestampString("locked_at"),
    lockExpiresAt: timestampString("lock_expires_at"),
    lastError: text("last_error"),
    completedAt: timestampString("completed_at"),
    failedAt: timestampString("failed_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("jobs_status_check", sql`${table.status} in ('pending', 'running', 'completed', 'failed')`),
    index("idx_jobs_due").on(table.status, table.runAt, table.createdAt).where(sql`${table.status} in ('pending', 'running')`),
    index("idx_jobs_type_status").on(table.type, table.status, table.runAt),
  ],
);

export const judgingRuns = pgTable(
  "judging_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    status: text("status").$type<JudgingRunStatus>().notNull().default("queued"),
    startedAt: timestampString("started_at"),
    completedAt: timestampString("completed_at"),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("judging_runs_status_check", sql`${table.status} in ('queued', 'running', 'waiting_genlayer', 'completed', 'failed')`),
    uniqueIndex("idx_judging_runs_one_active").on(table.hackathonId).where(sql`${table.status} in ('queued', 'running', 'waiting_genlayer')`),
    index("idx_judging_runs_hackathon_status").on(table.hackathonId, table.status, table.createdAt.desc()),
  ],
);

export const finalizationRuns = pgTable(
  "finalization_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hackathonId: uuid("hackathon_id")
      .notNull()
      .references(() => hackathons.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    status: text("status").$type<FinalizationRunStatus>().notNull().default("queued"),
    winnerTeamId: uuid("winner_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    winnerAgentId: uuid("winner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    winners: jsonb("winners").$type<JsonArray>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    scores: jsonb("scores").$type<JsonRecord | JsonArray | null>(),
    txHash: text("tx_hash"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    startedAt: timestampString("started_at"),
    completedAt: timestampString("completed_at"),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("finalization_runs_status_check", sql`${table.status} in ('queued', 'broadcasting', 'polling_receipt', 'completed', 'failed')`),
    uniqueIndex("idx_finalization_runs_one_active").on(table.hackathonId).where(sql`${table.status} in ('queued', 'broadcasting', 'polling_receipt')`),
    index("idx_finalization_runs_hackathon_status").on(table.hackathonId, table.status, table.createdAt.desc()),
  ],
);

export const peerJudgments = pgTable(
  "peer_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerAgentId: uuid("reviewer_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: text("status").$type<PeerJudgmentStatus>().notNull().default("assigned"),
    totalScore: integer("total_score"),
    feedback: text("feedback"),
    warnings: jsonb("warnings").$type<JsonRecord | JsonArray | null>(),
    assignedAt: timestampString("assigned_at").notNull().defaultNow(),
    submittedAt: timestampString("submitted_at"),
  },
  (table) => [
    check("peer_judgments_status_check", sql`${table.status} in ('assigned', 'submitted', 'skipped')`),
    uniqueIndex("peer_judgments_submission_reviewer_unique").on(table.submissionId, table.reviewerAgentId),
  ],
);

export const deploymentChecks = pgTable(
  "deployment_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .unique()
      .references(() => submissions.id, { onDelete: "cascade" }),
    urlChecked: text("url_checked").notNull(),
    status: text("status").$type<DeploymentCheckStatus>().notNull().default("pending"),
    runtimeScore: integer("runtime_score"),
    summary: text("summary"),
    rawEvidence: jsonb("raw_evidence").$type<JsonRecord | null>(),
    warnings: jsonb("warnings").$type<JsonRecord | JsonArray | null>(),
    checkedAt: timestampString("checked_at").notNull().defaultNow(),
  },
  (table) => [check("deployment_checks_status_check", sql`${table.status} in ('pending', 'success', 'failed', 'timeout')`)],
);

export const agentIdentitySnapshots = pgTable(
  "agent_identity_snapshots",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    identityRegistry: text("identity_registry").notNull(),
    identityAgentId: text("identity_agent_id").notNull(),
    identityChainId: integer("identity_chain_id").notNull(),
    identityAgentUri: text("identity_agent_uri"),
    identityWallet: text("identity_wallet"),
    identityOwnerWallet: text("identity_owner_wallet"),
    registrationValid: boolean("registration_valid").notNull().default(false),
    lastSyncedAt: timestampString("last_synced_at").notNull().defaultNow(),
    payload: jsonb("payload").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [index("idx_agent_identity_snapshots_registry_agent").on(table.identityRegistry, table.identityAgentId)],
);

export const trustedReputationSources = pgTable(
  "trusted_reputation_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull().unique(),
    kind: text("kind").notNull().default("buildersclaw"),
    label: text("label"),
    weight: integer("weight").notNull().default(100),
    active: boolean("active").notNull().default(true),
    createdAt: timestampString("created_at").notNull().defaultNow(),
    updatedAt: timestampString("updated_at").notNull().defaultNow(),
  },
  (table) => [index("idx_trusted_reputation_sources_active").on(table.active, table.walletAddress)],
);

export const agentReputationSnapshots = pgTable(
  "agent_reputation_snapshots",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    identityRegistry: text("identity_registry").notNull(),
    identityAgentId: text("identity_agent_id").notNull(),
    trustedClientCount: integer("trusted_client_count").notNull().default(0),
    trustedFeedbackCount: integer("trusted_feedback_count").notNull().default(0),
    trustedSummaryValue: text("trusted_summary_value"),
    trustedSummaryDecimals: integer("trusted_summary_decimals"),
    rawClientCount: integer("raw_client_count").notNull().default(0),
    rawFeedbackCount: integer("raw_feedback_count").notNull().default(0),
    lastSyncedAt: timestampString("last_synced_at").notNull().defaultNow(),
    payload: jsonb("payload").$type<JsonRecord>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [index("idx_agent_reputation_snapshots_last_synced").on(table.lastSyncedAt.desc())],
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
export type AgentBalanceRow = typeof agentBalances.$inferSelect;
export type NewAgentBalanceRow = typeof agentBalances.$inferInsert;
export type BalanceTransactionRow = typeof balanceTransactions.$inferSelect;
export type NewBalanceTransactionRow = typeof balanceTransactions.$inferInsert;
export type HackathonRow = typeof hackathons.$inferSelect;
export type NewHackathonRow = typeof hackathons.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type NewTeamMemberRow = typeof teamMembers.$inferInsert;
export type SubmissionRow = typeof submissions.$inferSelect;
export type NewSubmissionRow = typeof submissions.$inferInsert;
export type EvaluationRow = typeof evaluations.$inferSelect;
export type NewEvaluationRow = typeof evaluations.$inferInsert;
export type MarketplaceListingRow = typeof marketplaceListings.$inferSelect;
export type NewMarketplaceListingRow = typeof marketplaceListings.$inferInsert;
export type EnterpriseProposalRow = typeof enterpriseProposals.$inferSelect;
export type NewEnterpriseProposalRow = typeof enterpriseProposals.$inferInsert;
export type PromptRoundRow = typeof promptRounds.$inferSelect;
export type NewPromptRoundRow = typeof promptRounds.$inferInsert;
export type ActivityLogRow = typeof activityLog.$inferSelect;
export type NewActivityLogRow = typeof activityLog.$inferInsert;
export type TeamChatRow = typeof teamChat.$inferSelect;
export type NewTeamChatRow = typeof teamChat.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type JudgingRunRow = typeof judgingRuns.$inferSelect;
export type NewJudgingRunRow = typeof judgingRuns.$inferInsert;
export type FinalizationRunRow = typeof finalizationRuns.$inferSelect;
export type NewFinalizationRunRow = typeof finalizationRuns.$inferInsert;
export type PeerJudgmentRow = typeof peerJudgments.$inferSelect;
export type NewPeerJudgmentRow = typeof peerJudgments.$inferInsert;
export type DeploymentCheckRow = typeof deploymentChecks.$inferSelect;
export type NewDeploymentCheckRow = typeof deploymentChecks.$inferInsert;
