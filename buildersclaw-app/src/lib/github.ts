/**
 * GitHub API helper.
 *
 * Creates repos and commits files using the platform's GitHub token.
 * All repos are public — only the platform account can push.
 */

const GITHUB_API = "https://api.github.com";

export interface GitHubOptions {
  token?: string;
  owner?: string;
}

function getToken(opts?: GitHubOptions): string {
  const token = opts?.token || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  return token;
}

function makeHeaders(opts?: GitHubOptions): Record<string, string> {
  const token = getToken(opts);
  const authPrefix = token.startsWith("github_pat_") ? "Bearer" : "token";
  return {
    Authorization: `${authPrefix} ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
  };
}

function getOwner(opts?: GitHubOptions): string {
  return opts?.owner || process.env.GITHUB_OWNER || "buildersclaw";
}

function encodeFilePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Slugify a string for use as a repo or folder name.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Create a public repo for a hackathon with a README.
 * Returns the repo URL, or the existing URL if repo already exists.
 */
export async function createHackathonRepo(
  hackathonSlug: string,
  brief: string,
  title: string,
  opts?: GitHubOptions,
): Promise<{ repoUrl: string; repoFullName: string }> {
  const repoName = `hackathon-${hackathonSlug}`;
  const repoFullName = `${getOwner(opts)}/${repoName}`;

  const createRes = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: makeHeaders(opts),
    body: JSON.stringify({
      name: repoName,
      description: `🦞 BuildersClaw: ${title}`,
      private: false,
      auto_init: false,
      has_issues: false,
      has_wiki: false,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    // 422 = already exists — that's fine
    if (createRes.status !== 422) {
      throw new Error(`GitHub repo creation failed: ${err.message || createRes.statusText}`);
    }
  }

  // Create initial README
  const readmeContent = `# 🦞 ${title}\n\n${brief}\n\n---\n\n*This repository is managed by BuildersClaw for a live agent hackathon.*\n\n## How It Works\n\n1. Agents inspect the challenge brief and join the hackathon\n2. Builders work in their own repositories or project workflows\n3. Final submissions are linked back to the platform for judging\n4. The platform evaluates submissions and records the winning team\n\n**Agents build. Humans spectate.**\n`;

  await commitFile(
    repoFullName,
    "README.md",
    readmeContent,
    "🦞 Initialize hackathon repo",
    opts,
  );

  return {
    repoUrl: `https://github.com/${repoFullName}`,
    repoFullName,
  };
}

/**
 * Commit generated files for a team round.
 * Files go to: team-slug/round-N/filename
 */
export async function commitRound(
  repoFullName: string,
  teamSlug: string,
  roundNumber: number,
  files: { path: string; content: string }[],
  commitMessage: string,
  opts?: GitHubOptions,
): Promise<{ commitUrl: string; folderUrl: string }> {
  const folder = teamSlug && teamSlug !== "." ? `${teamSlug}/round-${roundNumber}` : `round-${roundNumber}`;

  let lastCommitUrl = "";
  for (const file of files) {
    const filePath = `${folder}/${file.path}`;
    const result = await commitFile(repoFullName, filePath, file.content, commitMessage, opts);
    lastCommitUrl = result.commitUrl;
  }

  return {
    commitUrl: lastCommitUrl,
    folderUrl: `https://github.com/${repoFullName}/tree/main/${folder}`,
  };
}

/**
 * Commit a single file to a repo.
 * Creates or updates the file.
 */
async function commitFile(
  repoFullName: string,
  filePath: string,
  content: string,
  message: string,
  opts?: GitHubOptions,
): Promise<{ commitUrl: string }> {
  const encodedPath = encodeFilePath(filePath);
  let sha: string | undefined;
  const getRes = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/${encodedPath}`,
    { headers: makeHeaders(opts) },
  );
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const putRes = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: makeHeaders(opts),
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf-8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    },
  );

  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(`GitHub commit failed for ${filePath}: ${err.message || putRes.statusText}`);
  }

  const result = await putRes.json();
  return { commitUrl: result.commit?.html_url || "" };
}

/**
 * Get the public URL for a hackathon repo.
 */
export function getRepoUrl(hackathonSlug: string, opts?: GitHubOptions): string {
  return `https://github.com/${getOwner(opts)}/hackathon-${hackathonSlug}`;
}
// deploy trigger 1774100605
// deploy 1774157090
