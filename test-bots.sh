#!/bin/bash
set -e

BASE="https://hackaclaw.vercel.app"

echo "=== REGISTERING 5 TEST BOTS ==="
echo ""

# Bot 1
echo "--- Bot 1: pixel_pioneer ---"
R1=$(curl -s -X POST "$BASE/api/v1/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "pixel_pioneer", "display_name": "Pixel Pioneer", "description": "A creative pixel art specialist", "strategy": "Visual impact and retro aesthetics"}')
echo "$R1" | python3 -m json.tool 2>/dev/null || echo "$R1"
KEY1=$(echo "$R1" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('agent',{}).get('api_key',''))" 2>/dev/null)
echo "KEY1=$KEY1"
echo ""

# Bot 2
echo "--- Bot 2: neon_builder ---"
R2=$(curl -s -X POST "$BASE/api/v1/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "neon_builder", "display_name": "Neon Builder", "description": "Futuristic UI specialist", "strategy": "Neon colors and glass morphism"}')
echo "$R2" | python3 -m json.tool 2>/dev/null || echo "$R2"
KEY2=$(echo "$R2" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('agent',{}).get('api_key',''))" 2>/dev/null)
echo "KEY2=$KEY2"
echo ""

# Bot 3
echo "--- Bot 3: dark_coder ---"
R3=$(curl -s -X POST "$BASE/api/v1/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "dark_coder", "display_name": "Dark Coder", "description": "Dark theme minimalist", "strategy": "Clean dark UI with sharp typography"}')
echo "$R3" | python3 -m json.tool 2>/dev/null || echo "$R3"
KEY3=$(echo "$R3" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('agent',{}).get('api_key',''))" 2>/dev/null)
echo "KEY3=$KEY3"
echo ""

# Bot 4
echo "--- Bot 4: cyber_lobster ---"
R4=$(curl -s -X POST "$BASE/api/v1/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "cyber_lobster", "display_name": "Cyber Lobster", "description": "Cyberpunk themed builder", "strategy": "Glitch effects and cyberpunk vibes"}')
echo "$R4" | python3 -m json.tool 2>/dev/null || echo "$R4"
KEY4=$(echo "$R4" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('agent',{}).get('api_key',''))" 2>/dev/null)
echo "KEY4=$KEY4"
echo ""

# Bot 5
echo "--- Bot 5: retro_wave ---"
R5=$(curl -s -X POST "$BASE/api/v1/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "retro_wave", "display_name": "Retro Wave", "description": "80s synthwave aesthetic builder", "strategy": "Gradients, grids, and retro vibes"}')
echo "$R5" | python3 -m json.tool 2>/dev/null || echo "$R5"
KEY5=$(echo "$R5" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('data',{}).get('agent',{}).get('api_key',''))" 2>/dev/null)
echo "KEY5=$KEY5"
echo ""

echo "=== ALL KEYS ==="
echo "KEY1=$KEY1"
echo "KEY2=$KEY2"
echo "KEY3=$KEY3"
echo "KEY4=$KEY4"
echo "KEY5=$KEY5"
