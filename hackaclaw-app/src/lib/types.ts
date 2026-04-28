export interface Agent {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
  api_key_hash: string;
  model: string;
  personality: string | null;
  strategy: string | null;
  total_earnings: number;
  total_hackathons: number;
  total_wins: number;
  reputation_score: number;
  status: string;
  created_at: string;
  last_active: string;
}

export interface Hackathon {
  id: string;
  title: string;
  description: string | null;
  brief: string;
  rules: string | null;
  entry_type: "free" | "paid";
  entry_fee: number;
  prize_pool: number;
  platform_fee_pct: number;
  max_participants: number;
  team_size_min: number;
  team_size_max: number;
  build_time_seconds: number;
  challenge_type: string;
  status: "open" | "closed" | "finalized";
  internal_status?: string;
  created_by: string | null;
  starts_at: string | null;
  ends_at: string | null;
  judging_criteria: string | null;
  github_repo?: string | null;
  contract_address?: string | null;
  chain_id?: number | null;
  winner?: {
    agent_id: string;
    team_id: string | null;
    winners: Array<{ agent_id: string; wallet: string; share_bps: number }> | null;
    notes: string | null;
    scores: unknown;
    finalized_at: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  hackathon_id: string;
  name: string;
  color: string;
  floor_number: number | null;
  status: "forming" | "ready" | "building" | "submitted" | "judged";
  created_by: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  agent_id: string;
  role: "leader" | "member" | "hired";
  revenue_share_pct: number;
  joined_via: "direct" | "marketplace";
  status: string;
  joined_at: string;
}

/**
 * Marketplace listing — a team leader posts a role they need filled.
 * Other agents browse and claim roles directly (no offers/negotiations).
 */
export interface MarketplaceListing {
  id: string;
  hackathon_id: string;
  team_id: string;
  posted_by: string;           // agent_id of the team leader
  role_title: string;           // e.g. "Frontend Dev", "API Engineer"
  role_description: string | null;
  share_pct: number;            // % of prize offered (5–50)
  status: "open" | "taken" | "withdrawn";
  taken_by: string | null;      // agent_id who claimed it
  taken_at: string | null;
  created_at: string;
}

export interface Submission {
  id: string;
  team_id: string;
  hackathon_id: string;
  html_content: string | null;
  preview_url: string | null;
  build_log: string | null;
  status: "pending" | "building" | "completed" | "failed";
  project_url?: string | null;
  repo_url?: string | null;
  notes?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Evaluation {
  id: string;
  submission_id: string;
  judge_agent_id: string | null;
  functionality_score: number;
  brief_compliance_score: number;
  code_quality_score: number;
  architecture_score: number;
  innovation_score: number;
  completeness_score: number;
  documentation_score: number;
  testing_score: number;
  security_score: number;
  deploy_readiness_score: number;
  // Legacy fields (kept for backward compat)
  visual_quality_score?: number;
  cta_quality_score?: number;
  copy_clarity_score?: number;
  deploy_success_score?: number;
  total_score: number;
  judge_feedback: string | null;
  raw_response: string | null;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  hackathon_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  event_type: string;
  event_data: string | null;
  created_at: string;
}

// API response types
export interface AgentPublicProfile {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
  model: string;
  metadata: {
    description: string | null;
    stack: string | null;
    model: string | null;
  };
  total_hackathons: number;
  total_wins: number;
  reputation_score: number;
  created_at: string;
}

export interface HackathonWithTeams extends Hackathon {
  teams: (Team & { members: TeamMemberWithAgent[] })[];
  total_teams: number;
  total_agents: number;
}

export interface TeamMemberWithAgent extends TeamMember {
  agent_name: string;
  agent_display_name: string | null;
  agent_avatar_url: string | null;
}

export interface RankedTeam {
  team_id: string;
  team_name: string;
  team_color: string;
  floor_number: number | null;
  rank?: number;
  total_score: number | null;
  judge_feedback: string | null;
  members: TeamMemberWithAgent[];
  submission_id: string | null;
  submission_status?: string | null;
  winner?: boolean;
  project_url?: string | null;
  repo_url?: string | null;
  submission_notes?: string | null;
  status: string;
}

// Building visualization types
export interface BuildingFloor {
  floor_number: number;
  team_id: string;
  team_name: string;
  color: string;
  lobsters: LobsterViz[];
  /** Empty desks/chairs prepared for future team members (v2) */
  empty_seats: number;
  status: string;
  score: number | null;
}

export interface LobsterViz {
  agent_id: string;
  agent_name: string;
  display_name: string | null;
  role: string;
  share_pct: number;
  size: "small" | "medium" | "large";  // based on share_pct
}
