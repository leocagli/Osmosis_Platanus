# 📋 BuildersClaw GenLayer Hackathon — Guía Paso a Paso

## Estado Actual (1 de Abril 2026)

- **Rama**: `feature/hackathon-bradbury-judge`
- **Build**: ✅ Pasa (`next build` sin errores)
- **Commit**: `60ccf76` — contrato mejorado + frontend nuevo + deploy script
- **Deadline hackathon**: **3 de Abril 2026** (~2 días)

---

## 🏗️ Lo que YA está hecho

### Contrato (`contracts/hackathon_judge.py`)
- Intelligent Contract en Python con GenLayer SDK
- Usa `run_nondet_unsafe` (Partial Field Matching) — el patrón más robusto
- 5 validadores independientes con LLMs diferentes eligen un ganador
- Consenso: `winner_team_id` debe coincidir entre validadores
- Métodos: `submit_contenders()`, `finalize()`, `get_result()`, `get_contenders()`, `get_hackathon_info()`

### Frontend (`frontend/`)
- Dashboard de judging on-chain en Next.js 16 + React 19 + Tailwind
- Componentes: `ContendersPanel`, `JudgeResultPanel`, `SubmitContendersModal`
- Hook: `useHackathonJudge` para interactuar con el contrato
- Conexión MetaMask con GenLayerJS

### Deploy Script (`deploy/deployScript.ts`)
- Deploya `hackathon_judge.py` con args: `hackathon_id`, `title`, `brief`
- Configuración via env vars

---

## 📦 Paso 1: Instalar GenLayer CLI

```bash
npm install -g genlayer
```

Verificar:
```bash
genlayer --version
```

Si da error de permisos en Windows, intentar:
```bash
npx genlayer --version
```

---

## 🔑 Paso 2: Crear cuenta en GenLayer

```bash
genlayer account create
```

Esto genera un par de claves (address + private key). **GUARDAR LA PRIVATE KEY**.

Ver tu cuenta:
```bash
genlayer account list
genlayer account show
```

---

## 💰 Paso 3: Obtener GEN tokens (Faucet)

1. Ir a: **https://testnet-faucet.genlayer.foundation/**
2. Pegar tu address de GenLayer
3. Recibir GEN tokens gratis para testnet

Verificar balance:
```bash
genlayer account show
```

---

## 🌐 Paso 4: Configurar red Bradbury

```bash
genlayer network set testnet_bradbury
```

Verificar:
```bash
genlayer network info
```

Debería mostrar:
- RPC: `https://rpc-bradbury.genlayer.com`
- Chain ID: `4221`

---

## 🚀 Paso 5: Deploy del contrato a Bradbury

Desde la carpeta `buildersclaw-genlayer/`:

```bash
npm run deploy
```

O directamente:
```bash
genlayer deploy --contract contracts/hackathon_judge.py --args "demo-001" "BuildersClaw AI Hackathon" "Build the best AI agent solution"
```

**IMPORTANTE**: Copiar la dirección del contrato que aparece en la salida:
```
✅ HackathonJudge deployed at: 0x1234...abcd
```

---

## ⚙️ Paso 6: Configurar frontend con la dirección del contrato

```bash
cd frontend
cp .env.example .env
```

Editar `frontend/.env`:
```env
NEXT_PUBLIC_GENLAYER_RPC_URL=https://rpc-bradbury.genlayer.com
NEXT_PUBLIC_GENLAYER_CHAIN_ID=4221
NEXT_PUBLIC_GENLAYER_CHAIN_NAME=GenLayer Bradbury
NEXT_PUBLIC_GENLAYER_SYMBOL=GEN
NEXT_PUBLIC_CONTRACT_ADDRESS=0x_TU_CONTRATO_AQUI
```

---

## 🖥️ Paso 7: Probar el frontend localmente

```bash
cd frontend
npm run dev
```

Abrir: **http://localhost:3000**

### Flujo de prueba:
1. Conectar MetaMask (botón arriba a la derecha)
2. Agregar la red GenLayer Bradbury a MetaMask:
   - Network Name: `GenLayer Bradbury`
   - RPC URL: `https://rpc-bradbury.genlayer.com`
   - Chain ID: `4221`
   - Symbol: `GEN`
3. Ver info del hackathon (se lee del contrato)
4. Click "Submit Contenders" → pegar JSON de contenders de prueba
5. Click "Finalize — Trigger On-Chain Consensus"
6. Esperar ~1-5 min (los 5 validadores corren LLMs)
7. Ver el resultado on-chain

### JSON de contenders de prueba:
```json
[
  {
    "team_id": "team-alpha-001",
    "team_name": "Alpha Builders",
    "repo_url": "https://github.com/alpha/submission",
    "repo_summary": "Full-stack AI agent that automates code review. Built with Next.js and GPT-4. Complete test suite, good docs.",
    "gemini_score": 82,
    "gemini_feedback": "Strong architecture, excellent brief compliance."
  },
  {
    "team_id": "team-beta-002",
    "team_name": "Beta Labs",
    "repo_url": "https://github.com/beta/submission",
    "repo_summary": "AI-powered CI/CD pipeline optimizer. Uses LangChain + custom agents. Innovative but docs lacking.",
    "gemini_score": 78,
    "gemini_feedback": "Innovative approach with solid code quality."
  },
  {
    "team_id": "team-gamma-003",
    "team_name": "Gamma Squad",
    "repo_url": "https://github.com/gamma/submission",
    "repo_summary": "Automated testing framework for smart contracts. Simple but effective. Good UX, basic architecture.",
    "gemini_score": 75,
    "gemini_feedback": "Complete solution with good UX."
  }
]
```

---

## 🔍 Paso 8: Verificar en el Explorer

Ir a: **https://explorer-bradbury.genlayer.com/**

Buscar tu contrato por address. Deberías ver:
- Transacción de deploy
- Transacción de `submit_contenders`
- Transacción de `finalize` (con los datos del consenso)

---

## 📝 Paso 9: Registrarse en DoraHacks

1. Ir a: **https://dorahacks.io/hackathon/genlayer-bradbury**
2. Click **"Register as Hacker"**
3. Login con GitHub o Email
4. Completar registro

---

## 📤 Paso 10: Submit BUIDL en DoraHacks

1. Ir a: **https://dorahacks.io/hackathon/genlayer-bradbury**
2. Click **"Submit BUIDL"**
3. Completar el formulario:

### Datos para el formulario:

**Project Name**: BuildersClaw On-Chain Judge

**One-liner**: Decentralized AI hackathon judging via GenLayer Optimistic Democracy — 5 validators, 5 different LLMs, one verifiable winner.

**Track**: Agentic Economy Infrastructure (o Future of Work)

**Description**:
```
BuildersClaw On-Chain Judge replaces single-AI hackathon judging with decentralized 
multi-validator consensus on GenLayer. After off-chain pre-scoring, top contenders 
are submitted to an Intelligent Contract where 5 independent validators running 
different LLMs each independently evaluate and pick a winner. Consensus is reached 
via the Equivalence Principle (Partial Field Matching) — validators must agree on 
WHO won, even though their reasoning differs. The result is on-chain, immutable, 
and verifiable by anyone.

This is a real production component of BuildersClaw, a B2B AI agent hackathon 
platform. It demonstrates GenLayer's core value: trustless decision-making for 
subjective judgments.
```

**GitHub repo**: `https://github.com/AgenteBuildersClaw/buildersclaw-genlayer` (rama `feature/hackathon-bradbury-judge`)

**Demo video**: (ver paso 11)

**Technologies**: Python, GenLayer SDK, Next.js, TypeScript, MetaMask, GenLayerJS

---

## 🎬 Paso 11: Grabar Video Demo

Requisito de DoraHacks: **Demo Video Required**.

### Guion del video (~2-3 min):

**Intro (20s)**:
- "This is BuildersClaw On-Chain Judge — decentralized hackathon judging on GenLayer"
- Mostrar el README brevemente

**Problema (15s)**:
- "Traditional hackathon judging uses a single AI or human judges — both are biased and opaque"

**Solución (20s)**:
- "We use GenLayer's Optimistic Democracy — 5 validators with different LLMs reach consensus"
- Mostrar diagrama de arquitectura del README

**Demo en vivo (60s)**:
1. Mostrar el frontend conectado
2. Ver info del hackathon (leída del contrato)
3. Mostrar contenders ya submitidos
4. (Si ya finalized) Mostrar el resultado on-chain
5. Mostrar en el Explorer la transacción

**Contrato (30s)**:
- Mostrar `hackathon_judge.py` brevemente
- Destacar `run_nondet_unsafe` y `leader_fn` / `validator_fn`
- "Validators agree on WHO won, not on the exact reasoning"

**Cierre (15s)**:
- "Verifiable, transparent, multi-model consensus judging"
- "Built for the real BuildersClaw platform"

### Herramientas para grabar:
- **OBS Studio** (gratis, Windows)
- **Loom** (fácil, con webcam)
- **Windows Game Bar** (`Win+G` → Record)

---

## 🔧 Troubleshooting

### "genlayer: command not found"
```bash
npx genlayer --version
# O reinstalar:
npm install -g genlayer
```

### "Insufficient funds" al deploy
- Ir al faucet: https://testnet-faucet.genlayer.foundation/
- Pedir más GEN tokens

### MetaMask no conecta
- Agregar red manualmente:
  - Network Name: GenLayer Bradbury
  - RPC: https://rpc-bradbury.genlayer.com
  - Chain ID: 4221
  - Symbol: GEN

### Finalize tarda mucho
- Es normal: 5 validadores corren LLMs independientemente
- Puede tardar 1-5 minutos
- Si falla con "UNDETERMINED": los validadores no alcanzaron consenso
  - Intentar de nuevo o simplificar el prompt

### Build falla
```bash
cd frontend
rm -rf node_modules .next
npm install
npx next build
```

### Deploy falla con error de red
```bash
genlayer network list
genlayer network set testnet_bradbury
genlayer network info
# Verificar que muestra rpc-bradbury.genlayer.com
```

---

## 📊 Datos Rápidos de Referencia

| Dato | Valor |
|------|-------|
| **Rama** | `feature/hackathon-bradbury-judge` |
| **Contract Address** | `0xcdcc9a730d3a7210072d46d889ca0bb4ec0051c5` |
| **Deploy TX** | `0xc0d40db6b56c323e468efdb21931ede607cafa9110c67c9281a2017402efcc8a` |
| **Testnet RPC** | `https://rpc-bradbury.genlayer.com` |
| **Chain ID** | `4221` |
| **Faucet** | `https://testnet-faucet.genlayer.foundation/` |
| **Explorer** | `https://explorer-bradbury.genlayer.com/` |
| **Studio** | `https://studio.genlayer.com/` |
| **DoraHacks** | `https://dorahacks.io/hackathon/genlayer-bradbury` |
| **Docs** | `https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup` |
| **SDK API** | `https://sdk.genlayer.com/main/_static/ai/api.txt` |
| **Full docs dump** | `https://docs.genlayer.com/full-documentation.txt` |
| **Boilerplate** | `https://github.com/genlayerlabs/genlayer-project-boilerplate` |
| **GenLayer MCP** | `claude mcp add genlayer npx -- -y genlayer-mcp` |
| **Docs MCP** | `claude mcp add genlayer-docs --transport sse https://docs-mcp.genlayer.com/sse` |

---

## ⏰ Timeline Recomendado

| Cuándo | Qué |
|--------|-----|
| **Hoy (1 abril)** | Pasos 1-8: Instalar, deploy, probar frontend |
| **Mañana (2 abril)** | Paso 9-11: Registrar DoraHacks, grabar video, submit |
| **3 abril** | Deadline — asegurarse de que todo esté submiteado |

---

## 🧠 Alternativa: Si Bradbury no funciona

Si hay problemas con el testnet Bradbury (a veces está inestable), hay alternativa:

### Usar Studionet (hosted, sin setup)
```bash
genlayer network set studionet
```

Frontend `.env`:
```env
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_GENLAYER_CHAIN_NAME=GenLayer Studio
```

### Usar GenLayer Studio local (requiere Docker)
```bash
npm install -g genlayer
genlayer init
genlayer up
# Studio en http://localhost:8080
# RPC en http://localhost:4000/api
```

### Usar GLSim (simulador liviano, sin Docker)
```bash
pip install genlayer-test[sim]
glsim --port 4000 --validators 5
# Conectar frontend a http://localhost:4000/api
```

---

## 📁 Estructura del proyecto

```
buildersclaw-genlayer/
├── contracts/
│   └── hackathon_judge.py       ← Intelligent Contract (Python)
├── deploy/
│   └── deployScript.ts          ← Script de deploy
├── frontend/
│   ├── app/
│   │   └── page.tsx             ← Dashboard principal
│   ├── components/
│   │   ├── AccountPanel.tsx     ← Conexión MetaMask
│   │   ├── ContendersPanel.tsx  ← Lista de contenders
│   │   ├── JudgeResultPanel.tsx ← Resultado on-chain
│   │   ├── SubmitContendersModal.tsx ← Modal para submitir
│   │   └── Logo.tsx
│   ├── lib/
│   │   ├── contracts/
│   │   │   └── HackathonJudge.ts ← Types del contrato
│   │   ├── hooks/
│   │   │   └── useHackathonJudge.ts ← React hook
│   │   └── genlayer/
│   │       ├── client.ts        ← Config GenLayer
│   │       ├── wallet.ts
│   │       └── WalletProvider.tsx
│   ├── .env.example
│   └── package.json
├── package.json
├── README.md                    ← README para hackathon
├── CLAUDE.md                    ← Referencia para Claude
└── HACKATHON-GUIDE.md           ← ESTE ARCHIVO
```
