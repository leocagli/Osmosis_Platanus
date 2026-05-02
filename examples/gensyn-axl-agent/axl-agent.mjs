#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));

const apiBase = trimTrailingSlash(args["api-base"] || process.env.BUILDERSCLAW_API_BASE || "http://127.0.0.1:3001");
const axlUrl = trimTrailingSlash(args["axl-url"] || process.env.AXL_URL || "http://127.0.0.1:9002");
const apiKey = args["api-key"] || process.env.BUILDERSCLAW_API_KEY;
const hackathonId = args["hackathon-id"] || process.env.BUILDERSCLAW_HACKATHON_ID;
const teamId = args["team-id"] || process.env.BUILDERSCLAW_TEAM_ID;
const listen = Boolean(args.listen);
const sendTo = args["send-to"];
const messageType = args.type || "status.update";
const messageText = args.message || "Hello from a BuildersClaw AXL agent.";
const repoUrl = args["submit-repo"];

if (!apiKey || !hackathonId || !teamId) {
  usage("Missing --api-key, --hackathon-id, or --team-id.");
}

const topology = await getTopology();
const me = await buildersClaw("/api/v1/agents/me");
const peerDiscovery = await buildersClaw(`/api/v1/hackathons/${hackathonId}/teams/${teamId}/axl-peers`);
const peers = peerDiscovery.peers || [];

log("agent", `${me.name || me.id} (${me.id})`);
log("axl", `local=${axlUrl} public_key=${topology.our_public_key || "unknown"}`);
log("team", `loaded ${peers.length} AXL peers from BuildersClaw`);

if (sendTo) {
  const peer = findPeer(peers, sendTo);
  if (!peer) {
    usage(`Could not find peer matching "${sendTo}". Available peers: ${peers.map(peerLabel).join(", ") || "none"}`);
  }
  if (!peer.axl_public_key) {
    usage(`Peer ${peerLabel(peer)} does not have axl_public_key configured.`);
  }

  const envelope = {
    version: 1,
    type: messageType,
    hackathon_id: hackathonId,
    team_id: teamId,
    from_agent_id: me.id,
    from_agent_name: me.name,
    to_agent_id: peer.agent_id,
    to_agent_name: peer.name,
    created_at: new Date().toISOString(),
    payload: {
      message: messageText,
      repo_url: repoUrl || null,
    },
  };

  await sendAxl(peer.axl_public_key, envelope);
  log("sent", `${messageType} -> ${peerLabel(peer)} via AXL`);
}

if (repoUrl) {
  await buildersClaw(`/api/v1/hackathons/${hackathonId}/teams/${teamId}/submit`, {
    method: "POST",
    body: JSON.stringify({ repo_url: repoUrl, notes: "Submitted after Gensyn AXL peer coordination." }),
  });
  log("submitted", repoUrl);
}

if (listen || (!sendTo && !repoUrl)) {
  log("listen", "polling AXL /recv. Press Ctrl+C to stop.");
  while (true) {
    await recvOnce();
    await sleep(300);
  }
}

async function getTopology() {
  const res = await fetch(`${axlUrl}/topology`);
  if (!res.ok) throw new Error(`AXL topology failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sendAxl(peerId, message) {
  const res = await fetch(`${axlUrl}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Destination-Peer-Id": peerId,
    },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`AXL send failed: ${res.status} ${await res.text()}`);
}

async function recvOnce() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${axlUrl}/recv`, { signal: controller.signal });
    if (res.status === 204 || res.status === 404) return;
    if (!res.ok) {
      log("recv-error", `${res.status} ${await res.text()}`);
      return;
    }
    const from = res.headers.get("X-From-Peer-Id") || "unknown";
    const text = await res.text();
    log("recv", `from=${from} body=${text}`);
  } catch (err) {
    if (err?.name !== "AbortError") log("recv-error", err.message || String(err));
  } finally {
    clearTimeout(timeout);
  }
}

async function buildersClaw(path, init = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(`BuildersClaw API failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return json?.data ?? json;
}

function findPeer(peers, target) {
  const clean = target.toLowerCase();
  return peers.find((peer) => {
    if (peer.is_self) return false;
    return [peer.agent_id, peer.name, peer.display_name, peer.role]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === clean || String(value).toLowerCase().includes(clean));
  });
}

function peerLabel(peer) {
  return `${peer.name || peer.agent_id}:${peer.role || "member"}${peer.axl_enabled ? ":axl" : ":no-axl"}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/$/, "");
}

function log(scope, message) {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage:
  node axl-agent.mjs --api-key <key> --hackathon-id <id> --team-id <id> --listen
  node axl-agent.mjs --api-key <key> --hackathon-id <id> --team-id <id> --send-to <peer-name-or-role> --type task.assigned --message "Build the endpoint"
  node axl-agent.mjs --api-key <key> --hackathon-id <id> --team-id <id> --send-to planner --type submission.ready --submit-repo https://github.com/team/repo

Options:
  --api-base       BuildersClaw API base URL. Default: http://127.0.0.1:3001
  --axl-url        Local AXL HTTP API URL. Default: http://127.0.0.1:9002
  --api-key        BuildersClaw agent API key
  --hackathon-id   Hackathon UUID
  --team-id        Team UUID
  --listen         Poll local AXL /recv and print inbound peer messages
  --send-to        Peer role/name/id from BuildersClaw AXL peer discovery
  --type           Message type. Default: status.update
  --message        Message payload text
  --submit-repo    Submit repo URL to BuildersClaw after optional AXL send
`);
  process.exit(1);
}
