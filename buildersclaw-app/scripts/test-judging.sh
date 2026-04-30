#!/usr/bin/env bash
# test-judging.sh — End-to-end test for the GenLayer judging pipeline
# Usage: bash scripts/test-judging.sh
# Requires: curl, jq — local server must be running on :3000

set -e

BASE="http://localhost:3000/api/v1"
ADMIN_KEY="admin_4cf8b24f94b3195289839499bf8958de9134065fbf6e4f9668d6b5b25fbde0f1"
SUPABASE_URL="https://jltbinljziasruigovwd.supabase.co"
SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdGJpbmxqemlhc3J1aWdvdndkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA0OTg5NywiZXhwIjoyMDg5NjI1ODk3fQ.JphtXkmntm7FzJKoNuW4BOLL8gahlj2jMHdSxm92sUg"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${BLUE}[>]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BuildersClaw — GenLayer Judging E2E Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Register 2 test agents ──────────────────────────────────────────────
log "Registering test agents..."

AGENT1=$(curl -s -X POST "$BASE/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"test_agent_alpha_'$(date +%s)'","display_name":"Test Agent Alpha"}')
echo "  Agent 1: $(echo $AGENT1 | jq -r '.data.name // .error')"
KEY1=$(echo $AGENT1 | jq -r '.data.api_key')
[ "$KEY1" == "null" ] && fail "Agent 1 registration failed: $AGENT1"
ok "Agent 1: $(echo $AGENT1 | jq -r '.data.name') — key saved"

AGENT2=$(curl -s -X POST "$BASE/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"test_agent_beta_'$(date +%s)'","display_name":"Test Agent Beta"}')
echo "  Agent 2: $(echo $AGENT2 | jq -r '.data.name // .error')"
KEY2=$(echo $AGENT2 | jq -r '.data.api_key')
[ "$KEY2" == "null" ] && fail "Agent 2 registration failed: $AGENT2"
ok "Agent 2: $(echo $AGENT2 | jq -r '.data.name') — key saved"

# ── 2. Create hackathon directly via Supabase ──────────────────────────────
log "Creating test hackathon via Supabase..."

HACK_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")
ENDS_AT=$(date -u -d '+2 hours' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+2H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow()+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

CREATE_HACK=$(curl -s -X POST "$SUPABASE_URL/rest/v1/hackathons" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"id\": \"$HACK_ID\",
    \"title\": \"Test Judging Hackathon $(date +%s)\",
    \"brief\": \"Build a web app that shows real-time crypto prices using a public API. The app must display at least 5 cryptocurrencies, support sorting by price, and have a clean UI. Bonus: add historical price charts.\",
    \"status\": \"open\",
    \"join_mode\": \"free\",
    \"entry_fee\": 0,
    \"prize_pool\": 1000,
    \"currency\": \"USD\",
    \"starts_at\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || python3 -c \"from datetime import datetime; print(datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))\")\" ,
    \"ends_at\": \"$ENDS_AT\"
  }")

echo "  Response: $(echo $CREATE_HACK | jq -r '.[0].id // .[0] // .')"
HACK_ID_CHECK=$(echo $CREATE_HACK | jq -r '.[0].id // empty')
[ -z "$HACK_ID_CHECK" ] && fail "Hackathon creation failed: $CREATE_HACK"
ok "Hackathon created: $HACK_ID"

# ── 3. Both agents join ────────────────────────────────────────────────────
log "Agent 1 joining hackathon..."
JOIN1=$(curl -s -X POST "$BASE/hackathons/$HACK_ID/join" \
  -H "Authorization: Bearer $KEY1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Alpha"}')
TEAM1=$(echo $JOIN1 | jq -r '.data.team_id // .data.team.id // empty')
echo "  Response: $(echo $JOIN1 | jq -r '.data.team_id // .error // .')"
[ -z "$TEAM1" ] && fail "Agent 1 join failed: $JOIN1"
ok "Agent 1 joined — team: $TEAM1"

log "Agent 2 joining hackathon..."
JOIN2=$(curl -s -X POST "$BASE/hackathons/$HACK_ID/join" \
  -H "Authorization: Bearer $KEY2" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Beta"}')
TEAM2=$(echo $JOIN2 | jq -r '.data.team_id // .data.team.id // empty')
echo "  Response: $(echo $JOIN2 | jq -r '.data.team_id // .error // .')"
[ -z "$TEAM2" ] && fail "Agent 2 join failed: $JOIN2"
ok "Agent 2 joined — team: $TEAM2"

# ── 4. Submit repos ────────────────────────────────────────────────────────
log "Agent 1 submitting repo..."
SUB1=$(curl -s -X POST "$BASE/hackathons/$HACK_ID/teams/$TEAM1/submit" \
  -H "Authorization: Bearer $KEY1" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/moondevonyt/moon-dev-ai-agents-for-trading",
    "notes": "Full-stack crypto dashboard with real-time prices. Built with Next.js + TailwindCSS. Supports 20+ tokens with live sorting and 7-day history charts."
  }')
echo "  Response: $(echo $SUB1 | jq -r '.data.submission_id // .error // .')"
[[ "$(echo $SUB1 | jq -r '.success')" != "true" ]] && fail "Agent 1 submission failed: $SUB1"
ok "Agent 1 submitted"

log "Agent 2 submitting repo..."
SUB2=$(curl -s -X POST "$BASE/hackathons/$HACK_ID/teams/$TEAM2/submit" \
  -H "Authorization: Bearer $KEY2" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/adrianhajdin/crypto_screener_app",
    "notes": "Crypto screener app with TradingView charts, live price feeds, and portfolio tracker. React + Tailwind. Deployed on Vercel."
  }')
echo "  Response: $(echo $SUB2 | jq -r '.data.submission_id // .error // .')"
[[ "$(echo $SUB2 | jq -r '.success')" != "true" ]] && fail "Agent 2 submission failed: $SUB2"
ok "Agent 2 submitted"

# ── 5. Trigger judging ─────────────────────────────────────────────────────
echo ""
log "Triggering AI judging (this will take a few minutes — Gemini + GenLayer)..."
echo "  Hackathon: $HACK_ID"
echo ""

JUDGE=$(curl -s -X POST "$BASE/admin/hackathons/$HACK_ID/judge" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  --max-time 360)

echo ""
echo "━━━ JUDGING RESULT ━━━"
echo $JUDGE | jq '.'

# Summary
SUCCESS=$(echo $JUDGE | jq -r '.success')
if [ "$SUCCESS" == "true" ]; then
  WINNER=$(echo $JUDGE | jq -r '.data.hackathon.winner_team_id // "unknown"')
  GL_CONTRACT=$(echo $JUDGE | jq -r '.data.hackathon.genlayer_contract // "none"')
  echo ""
  ok "JUDGING COMPLETE"
  echo "  Winner team:       $WINNER"
  echo "  GenLayer contract: $GL_CONTRACT"
  echo ""
  echo "━━━ LEADERBOARD ━━━"
  echo $JUDGE | jq '.data.leaderboard'
else
  echo ""
  fail "Judging failed: $(echo $JUDGE | jq -r '.error // .')"
fi
