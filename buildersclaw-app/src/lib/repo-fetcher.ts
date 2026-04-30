/**
 * GitHub Repository Fetcher for AI Judging.
 *
 * Fetches repository file tree and key source files to feed the judge LLM.
 * Prioritizes: README, dependency manifests, source code, configs.
 * Respects a total size budget to stay within LLM context limits.
 */

const GITHUB_API = "https://api.github.com";

// ─── Priority tiers for file selection ───

/** Files we ALWAYS want (if they exist) */
const TIER_1_EXACT = [
  "README.md", "readme.md", "README.rst",
  "package.json", "Cargo.toml", "requirements.txt", "pyproject.toml",
  "go.mod", "Gemfile", "pom.xml", "build.gradle",
  "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
];

/** Directory prefixes where source code lives */
const SOURCE_DIRS = [
  "src/", "lib/", "app/", "pages/", "components/", "api/",
  "cmd/", "pkg/", "internal/", "core/", "services/", "routes/",
  "controllers/", "models/", "utils/", "helpers/",
];

/** File extensions we care about (source code) */
const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
  ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".kt",
  ".sol", ".vue", ".svelte", ".astro",
  ".sql", ".graphql", ".gql", ".prisma",
  ".css", ".scss", ".less", ".tailwind",
  ".html", ".htm",
  ".yaml", ".yml", ".toml", ".json",
  ".md", ".mdx",
  ".sh", ".bash",
  ".env.example",
];

/** Files/dirs to always skip */
const SKIP_PATTERNS = [
  "node_modules/", ".git/", "dist/", "build/", ".next/", "__pycache__/",
  "target/", "vendor/", ".venv/", "venv/", ".cache/",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "Cargo.lock", "Gemfile.lock", "poetry.lock",
  ".DS_Store", "thumbs.db",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".rar",
  ".mp4", ".mp3", ".wav", ".ogg",
  ".pdf", ".doc", ".docx",
  ".min.js", ".min.css", ".map",
];

// ─── Types ───

export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface RepoAnalysis {
  owner: string;
  repo: string;
  url: string;
  tree: string[];
  files: RepoFile[];
  readme: string | null;
  totalFiles: number;
  fetchedFiles: number;
  totalSizeFetched: number;
  error?: string;
}

// ─── URL Parsing ───

export function parseGitHubUrl(url: string): { owner: string; repo: string; path?: string } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return null;

    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];

    // Handle URLs like github.com/owner/repo/tree/main/path
    let path: string | undefined;
    if (parts.length > 4 && (parts[2] === "tree" || parts[2] === "blob")) {
      path = parts.slice(4).join("/");
    }

    return { owner, repo, path };
  } catch {
    return null;
  }
}

// ─── GitHub API Helpers ───

function apiHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Only add auth if we have a valid-looking token
  if (token && token.length > 10 && !token.includes("your-key")) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

function shouldSkip(path: string): boolean {
  const lower = path.toLowerCase();
  return SKIP_PATTERNS.some((p) => lower.includes(p));
}

function isCodeFile(path: string): boolean {
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isSourceDir(path: string): boolean {
  return SOURCE_DIRS.some((dir) => path.startsWith(dir));
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();

  // Tier 1: exact matches (README, package.json, etc.)
  if (TIER_1_EXACT.some((f) => lower === f.toLowerCase())) return 0;

  // Tier 2: root-level source files
  if (!path.includes("/") && isCodeFile(path)) return 1;

  // Tier 3: source directory files
  if (isSourceDir(path) && isCodeFile(path)) return 2;

  // Tier 4: config files in root
  if (!path.includes("/") && (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml"))) return 3;

  // Tier 5: other code files
  if (isCodeFile(path)) return 4;

  // Tier 6: everything else
  return 5;
}

// ─── Core Fetcher ───

/**
 * Fetch the full file tree of a GitHub repository using the Git Trees API.
 */
async function fetchTree(owner: string, repo: string, token?: string): Promise<string[]> {
  // Try with token first; on 401 retry without token (handles expired tokens gracefully)
  async function tryFetch(branch: string, tok: string | undefined): Promise<Response> {
    return fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: apiHeaders(tok) }
    );
  }

  let res = await tryFetch("HEAD", token);
  if (res.status === 401 && token) res = await tryFetch("HEAD", undefined);

  if (!res.ok) {
    let mainRes = await tryFetch("main", token);
    if (mainRes.status === 401 && token) mainRes = await tryFetch("main", undefined);
    if (!mainRes.ok) {
      throw new Error(`Failed to fetch repo tree: ${mainRes.status} ${mainRes.statusText}`);
    }
    const mainData = await mainRes.json();
    return (mainData.tree || [])
      .filter((item: { type: string }) => item.type === "blob")
      .map((item: { path: string }) => item.path);
  }

  const data = await res.json();
  return (data.tree || [])
    .filter((item: { type: string }) => item.type === "blob")
    .map((item: { path: string }) => item.path);
}

/**
 * Fetch the raw content of a single file from a GitHub repository.
 */
async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  token?: string
): Promise<string | null> {
  try {
    let res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      { headers: { ...apiHeaders(token), Accept: "application/vnd.github.raw+json" } }
    );
    // Retry without token on 401 (expired/revoked)
    if (res.status === 401 && token) {
      res = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
        { headers: { ...apiHeaders(undefined), Accept: "application/vnd.github.raw+json" } }
      );
    }
    if (!res.ok) return null;
    const text = await res.text();
    return text;
  } catch {
    return null;
  }
}

// ─── Main Export ───

/**
 * Fetch and analyze a GitHub repository for AI judging.
 *
 * @param repoUrl - Full GitHub URL (e.g. https://github.com/user/repo)
 * @param maxFiles - Max number of files to fetch content for (default: 30)
 * @param maxTotalBytes - Max total bytes of content to fetch (default: 150KB)
 */
export async function fetchRepoForJudging(
  repoUrl: string,
  maxFiles = 30,
  maxTotalBytes = 150_000,
): Promise<RepoAnalysis> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return {
      owner: "", repo: "", url: repoUrl,
      tree: [], files: [], readme: null,
      totalFiles: 0, fetchedFiles: 0, totalSizeFetched: 0,
      error: "Invalid GitHub URL",
    };
  }

  const { owner, repo } = parsed;
  
  // Use GITHUB_TOKEN if it looks like a valid token (no live validation — avoids wasting rate limit)
  const envToken = process.env.GITHUB_TOKEN;
  const token: string | undefined =
    envToken && envToken.length > 10 && !envToken.includes("your-key") ? envToken : undefined;

  let tree: string[];
  try {
    tree = await fetchTree(owner, repo, token);
  } catch (e) {
    return {
      owner, repo, url: repoUrl,
      tree: [], files: [], readme: null,
      totalFiles: 0, fetchedFiles: 0, totalSizeFetched: 0,
      error: `Failed to fetch repo: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Filter out files we should skip
  const validFiles = tree.filter((path) => !shouldSkip(path));

  // Sort by priority
  const sorted = [...validFiles].sort((a, b) => filePriority(a) - filePriority(b));

  // Fetch files up to limits
  const fetchedFiles: RepoFile[] = [];
  let totalSize = 0;
  let readme: string | null = null;

  for (const path of sorted) {
    if (fetchedFiles.length >= maxFiles) break;
    if (totalSize >= maxTotalBytes) break;

    const content = await fetchFileContent(owner, repo, path, token);
    if (!content) continue;

    // Respect size budget
    const size = new TextEncoder().encode(content).length;
    if (totalSize + size > maxTotalBytes && fetchedFiles.length > 0) {
      // If we already have files and this one would exceed budget, skip
      continue;
    }

    fetchedFiles.push({ path, content, size });
    totalSize += size;

    // Track README
    if (path.toLowerCase() === "readme.md" || path.toLowerCase() === "readme.rst") {
      readme = content;
    }
  }

  return {
    owner,
    repo,
    url: repoUrl,
    tree: validFiles,
    files: fetchedFiles,
    readme,
    totalFiles: validFiles.length,
    fetchedFiles: fetchedFiles.length,
    totalSizeFetched: totalSize,
  };
}

/**
 * Format repo analysis into a text block suitable for LLM consumption.
 */
export function formatRepoForPrompt(analysis: RepoAnalysis): string {
  if (analysis.error) {
    return `[ERROR] Could not fetch repository: ${analysis.error}\nURL: ${analysis.url}`;
  }

  const sections: string[] = [];

  // Header
  sections.push(`=== REPOSITORY: ${analysis.owner}/${analysis.repo} ===`);
  sections.push(`URL: ${analysis.url}`);
  sections.push(`Total files: ${analysis.totalFiles}`);
  sections.push(`Files analyzed: ${analysis.fetchedFiles}`);
  sections.push("");

  // File tree (full)
  sections.push("── FILE TREE ──");
  for (const path of analysis.tree) {
    sections.push(`  ${path}`);
  }
  sections.push("");

  // File contents
  sections.push("── SOURCE CODE ──");
  for (const file of analysis.files) {
    sections.push(`\n━━━ ${file.path} (${file.size} bytes) ━━━`);
    sections.push(file.content);
  }

  return sections.join("\n");
}
