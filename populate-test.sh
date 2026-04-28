#!/bin/bash
BASE="https://buildersclaw.vercel.app"
HID="c9f8aa94-64dd-437c-b028-90125210d8d7"

TEAM_NAMES=("Neon Forge" "Byte Wolves" "Pixel Storm" "Dark Circuit" "Code Ronin" "Ghost Shell" "Iron Flux" "Cyber Hive" "Nova Core" "Rust Riders")
COLORS=("#00ffaa" "#ff6b6b" "#4ecdc4" "#ffd93d" "#6c5ce7" "#fd79a8" "#00b894" "#e17055" "#0984e3" "#a29bfe")
MODELS=("gemini" "openai" "claude" "gemini" "openai" "claude" "gemini" "openai" "claude" "gemini")
STYLES=("cyberpunk neon" "minimalist dark" "retro synthwave" "glassmorphism" "brutalist" "vaporwave pastel" "matrix terminal" "gradient mesh" "neumorphic dark" "pixel art")

for i in $(seq 0 9); do
  TEAM="${TEAM_NAMES[$i]}"
  COLOR="${COLORS[$i]}"
  STYLE="${STYLES[$i]}"
  
  MEMBERS=$((RANDOM % 4 + 1))
  echo "=== Team $((i+1)): $TEAM ($MEMBERS members, style: $STYLE) ==="
  
  SLUG=$(echo "$TEAM" | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
  TS=$(date +%s%N | tail -c 8)
  
  # Register lead agent
  REG=$(curl -s -X POST "$BASE/api/v1/agents/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${SLUG}_lead_${TS}\", \"display_name\": \"${TEAM} Lead\", \"model\": \"${MODELS[$i]}\"}")
  KEY=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['agent']['api_key'])" 2>/dev/null)
  
  if [ -z "$KEY" ]; then
    echo "  FAIL register: $REG"
    continue
  fi
  
  # Give test credits
  curl -s -X POST "$BASE/api/v1/balance/test-credit" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d '{"secret": "buildersclaw-test-2026", "amount_usd": 1}' > /dev/null
  echo "  Lead registered + $1 credits"
  
  # Join hackathon
  JOIN=$(curl -s -X POST "$BASE/api/v1/hackathons/$HID/join" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d "{\"name\": \"$TEAM\", \"color\": \"$COLOR\"}")
  TID=$(echo "$JOIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['team']['id'])" 2>/dev/null)
  
  if [ -z "$TID" ]; then
    echo "  FAIL join: $JOIN"
    continue
  fi
  echo "  Team: $TID"
  
  # Add extra members
  for m in $(seq 2 $MEMBERS); do
    MTS=$(date +%s%N | tail -c 8)
    MREG=$(curl -s -X POST "$BASE/api/v1/agents/register" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"${SLUG}_m${m}_${MTS}\", \"display_name\": \"${TEAM} #${m}\", \"model\": \"${MODELS[$(((i+m) % 10))]]}\"}")
    MKEY=$(echo "$MREG" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['agent']['api_key'])" 2>/dev/null)
    
    if [ -n "$MKEY" ]; then
      curl -s -X POST "$BASE/api/v1/hackathons/$HID/teams/$TID/join" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $MKEY" > /dev/null 2>&1
      echo "  +Member $m"
    fi
  done
  
  # Submit prompt
  echo "  Building..."
  PROMPT=$(curl -s -X POST "$BASE/api/v1/hackathons/$HID/teams/$TID/prompt" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d "{\"prompt\": \"Build an incredible developer portfolio with ${STYLE} aesthetic. Use ${COLOR} as the accent color. Include: animated hero section with a catchy tagline, about section with skill bars, 4+ project cards with hover effects, contact form with validation, smooth scroll nav. Make it unforgettable.\"}")
  ROUND=$(echo "$PROMPT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Round {d[\"data\"][\"round\"]} done ({d[\"data\"][\"model\"]})')" 2>/dev/null)
  
  if [ -n "$ROUND" ]; then
    echo "  $ROUND"
  else
    ERR=$(echo "$PROMPT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message','unknown'))" 2>/dev/null)
    echo "  FAIL prompt: $ERR"
  fi
  echo ""
done

echo "Done! View: $BASE/hackathons/$HID"
