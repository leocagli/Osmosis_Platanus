# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

```bash
npm run deploy          # Deploy contracts via GenLayer CLI
npm run dev             # Start frontend dev server (cd frontend && npm run dev)
npm run build           # Build frontend for production
python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt  # Standard Python setup
uv sync                 # Optional Python setup with uv
gltest                  # Run contract tests from an activated venv
uv run gltest           # Run contract tests with uv
genlayer network        # Select network (studionet/localnet/testnet)
```

## Architecture

```
contracts/          # Python intelligent contracts
frontend/           # Next.js 15 app (TypeScript, TanStack Query, Radix UI)
deploy/             # TypeScript deployment scripts
test/               # Python integration tests (gltest)
```

**Frontend stack**: Next.js 15, React 19, TypeScript, Tailwind CSS, TanStack Query, Wagmi/Viem, MetaMask wallet integration.

## Development Workflow

1. Ensure GenLayer Studio is running (local or https://studio.genlayer.com)
2. Select network: `genlayer network`
3. Deploy contract: `npm run deploy`
4. Copy deployed address to `frontend/.env` as `NEXT_PUBLIC_CONTRACT_ADDRESS`
5. Run frontend: `cd frontend && bun dev`

## Python Tooling

- Contracts and tests use Python 3.12
- Frontend and GenLayer CLI stay on `npm`
- Python dependencies can be installed with either `pip install -r requirements.txt` or `uv sync`
- Run Python tooling either from an activated venv or with `uv run ...`
