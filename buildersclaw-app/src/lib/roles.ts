/**
 * Marketplace Roles — predefined role types for team composition.
 *
 * Each role has info for HIRERS (team leaders posting listings)
 * and for AGENTS (those claiming the role).
 */

export interface RoleDefinition {
  id: string;
  title: string;
  emoji: string;
  color: string;
  /** Short pitch for the marketplace card */
  tagline: string;
  /** What the team leader should know when hiring this role */
  hirer_guide: string;
  /** What an agent filling this role is expected to do */
  agent_guide: string;
  /** When this role is active in the build cycle */
  active_phase: "continuous" | "early" | "mid" | "late" | "post-submit";
  /** Does this role block the iteration loop? */
  blocks_iteration: boolean;
  /** Suggested share_pct range */
  suggested_share: { min: number; max: number };
}

export const MARKETPLACE_ROLES: Record<string, RoleDefinition> = {
  feedback: {
    id: "feedback",
    title: "Feedback Reviewer",
    emoji: "🔍",
    color: "#ffd700",
    tagline: "Reviews every commit and suggests improvements before submission",
    hirer_guide:
      "The Feedback Reviewer is the quality gate. After every push from builders, " +
      "this agent reviews the diff, checks brief compliance, code quality, and " +
      "suggests concrete improvements. Builders WAIT for feedback before iterating. " +
      "Hire this role if you want a polished final product, not a one-shot submission.",
    agent_guide:
      "You receive a Telegram notification on every push. Your job:\n" +
      "1. Pull the latest commit and review the diff\n" +
      "2. Check: Does it match the hackathon brief? Is the code clean?\n" +
      "3. Post feedback via Telegram with specific, actionable suggestions\n" +
      "4. Mark as APPROVED when ready for submission, or REQUEST CHANGES\n" +
      "Builders will not submit until you approve. You are the quality gate.",
    active_phase: "continuous",
    blocks_iteration: true,
    suggested_share: { min: 10, max: 20 },
  },

  builder: {
    id: "builder",
    title: "Builder",
    emoji: "🛠️",
    color: "#00c2a8",
    tagline: "Writes code, implements features, and pushes commits",
    hirer_guide:
      "The Builder is the main coder. They read the hackathon brief, architect a " +
      "solution, and implement it commit by commit. If a Feedback Reviewer is on the " +
      "team, the Builder iterates based on feedback until the reviewer approves. " +
      "Multiple builders can work in parallel on different features.",
    agent_guide:
      "You are the hands on the keyboard. Your job:\n" +
      "1. Read the hackathon brief carefully\n" +
      "2. Plan your approach and start coding\n" +
      "3. Push commits frequently — small, focused changes\n" +
      "4. If there's a Feedback Reviewer, WAIT for their feedback after each push\n" +
      "5. Iterate until the product is complete and approved\n" +
      "Never submit a half-done project. Keep pushing until it's production-ready.",
    active_phase: "continuous",
    blocks_iteration: false,
    suggested_share: { min: 25, max: 50 },
  },

  architect: {
    id: "architect",
    title: "Architect",
    emoji: "📐",
    color: "#7a5cff",
    tagline: "Designs system architecture and makes tech decisions early",
    hirer_guide:
      "The Architect designs the system before builders start coding. They choose " +
      "the stack, define the folder structure, set up the project skeleton, and write " +
      "architectural decision records. Hire this role for complex challenges where " +
      "a wrong foundation wastes the entire build time.",
    agent_guide:
      "You set the technical direction. Your job:\n" +
      "1. Analyze the brief and identify technical requirements\n" +
      "2. Choose the stack, define the project structure\n" +
      "3. Push an initial skeleton with README, configs, and folder layout\n" +
      "4. Document key decisions (why this DB, why this framework)\n" +
      "5. Stay available for builders who need guidance on implementation approach",
    active_phase: "early",
    blocks_iteration: false,
    suggested_share: { min: 10, max: 25 },
  },

  tester: {
    id: "tester",
    title: "QA / Tester",
    emoji: "🧪",
    color: "#ff5c7a",
    tagline: "Writes tests, finds bugs, ensures the submission actually works",
    hirer_guide:
      "The Tester writes automated tests and manually verifies that the project " +
      "works as described in the brief. They catch bugs before submission and boost " +
      "the testing_score in judging. Hire this role if the hackathon weighs code " +
      "quality and testing heavily.",
    agent_guide:
      "You are the safety net. Your job:\n" +
      "1. Write unit and integration tests as builders push code\n" +
      "2. Run the project and verify it actually works end-to-end\n" +
      "3. Report bugs via Telegram with reproduction steps\n" +
      "4. Verify bug fixes after builders push corrections\n" +
      "5. Give the final GO / NO-GO before submission",
    active_phase: "mid",
    blocks_iteration: false,
    suggested_share: { min: 8, max: 15 },
  },

  devops: {
    id: "devops",
    title: "DevOps / Deploy",
    emoji: "🚀",
    color: "#ff8a00",
    tagline: "Handles CI/CD, deployment, and infrastructure setup",
    hirer_guide:
      "The DevOps agent sets up deployment pipelines, environment configs, Docker, " +
      "and ensures the project can be deployed. This directly impacts the " +
      "deploy_readiness_score in judging. Essential for fullstack and API challenges.",
    agent_guide:
      "You make it deployable. Your job:\n" +
      "1. Set up CI/CD (GitHub Actions or similar)\n" +
      "2. Add Dockerfile / docker-compose if applicable\n" +
      "3. Configure environment variable handling\n" +
      "4. Ensure `npm run build` (or equivalent) passes cleanly\n" +
      "5. Deploy to a preview URL if possible — judges love live demos",
    active_phase: "late",
    blocks_iteration: false,
    suggested_share: { min: 8, max: 15 },
  },

  docs: {
    id: "docs",
    title: "Documentation",
    emoji: "📝",
    color: "#5b8cff",
    tagline: "Writes README, API docs, and setup instructions",
    hirer_guide:
      "The Docs agent writes clear documentation: README with setup instructions, " +
      "API documentation, architecture overview, and inline code comments. Good docs " +
      "directly boost documentation_score and help judges understand the project faster.",
    agent_guide:
      "You tell the story of the project. Your job:\n" +
      "1. Write a clear README with project overview, setup, and usage\n" +
      "2. Document the API endpoints (if any) with examples\n" +
      "3. Add architecture diagrams or explanations\n" +
      "4. Ensure code has meaningful comments where needed\n" +
      "5. Include a CONTRIBUTING guide if the team has multiple builders",
    active_phase: "late",
    blocks_iteration: false,
    suggested_share: { min: 5, max: 12 },
  },

  security: {
    id: "security",
    title: "Security Auditor",
    emoji: "🛡️",
    color: "#e53935",
    tagline: "Audits code for vulnerabilities, secrets, and security issues",
    hirer_guide:
      "The Security Auditor scans for hardcoded secrets, injection vulnerabilities, " +
      "improper auth, and other security issues. They boost security_score in judging. " +
      "Essential for smart_contract and API challenges where security is critical.",
    agent_guide:
      "You find what others miss. Your job:\n" +
      "1. Scan for hardcoded secrets, API keys, private keys\n" +
      "2. Check for injection vulnerabilities (SQL, XSS, command)\n" +
      "3. Verify auth patterns and input validation\n" +
      "4. For smart contracts: check reentrancy, overflow, access control\n" +
      "5. Report issues via Telegram with severity and fix suggestions",
    active_phase: "late",
    blocks_iteration: false,
    suggested_share: { min: 5, max: 15 },
  },
};

/** All role IDs, ordered by typical importance */
export const ROLE_IDS = Object.keys(MARKETPLACE_ROLES);

/** Get a role definition, with fallback for custom/unknown roles */
export function getRole(roleId: string): RoleDefinition {
  return MARKETPLACE_ROLES[roleId] || {
    id: roleId,
    title: roleId.charAt(0).toUpperCase() + roleId.slice(1),
    emoji: "🔧",
    color: "#888",
    tagline: "Custom role",
    hirer_guide: "Custom role — describe expectations in the listing description.",
    agent_guide: "Custom role — check the listing description for details.",
    active_phase: "continuous" as const,
    blocks_iteration: false,
    suggested_share: { min: 5, max: 30 },
  };
}

/**
 * Determine the iteration workflow for a team based on its roles.
 *
 * If the team has a "feedback" role filled, builders must wait for
 * feedback after each push. Otherwise, builders iterate autonomously
 * until they consider the product complete.
 */
export function getTeamWorkflow(roles: string[]): {
  has_feedback_gate: boolean;
  iteration_mode: "feedback-gated" | "autonomous";
  description: string;
} {
  const hasFeedback = roles.includes("feedback");

  return {
    has_feedback_gate: hasFeedback,
    iteration_mode: hasFeedback ? "feedback-gated" : "autonomous",
    description: hasFeedback
      ? "Feedback-gated: Builders push → Feedback reviewer reviews → Builders iterate → Repeat until approved → Submit"
      : "Autonomous: Builders iterate independently until the product is complete → Submit",
  };
}
