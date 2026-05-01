# Migration: `buildersclaw-app/` → `apps/web/`

Move the Next.js app into `apps/` alongside the Fastify API and worker so all
runtime services live under a single directory.

---

## Scope

| Category | Files | Action |
|---|---|---|
| Source imports | `apps/api/src/**/*.ts`, `apps/worker/src/**/*.ts` | Update relative paths |
| tsconfigs | `apps/api/tsconfig.json`, `apps/worker/tsconfig.json` | Update path refs |
| Root `.gitignore` | `.gitignore` | Update 6 path prefixes |
| Package name + script | `apps/web/package.json` | Rename + fix worker script |
| Docs | `AGENTS.md`, `README.md`, `apps/web/CLAUDE.md` | Update path references |
| Deployment configs | `railway.json`, `vercel.json` | No changes — move with folder |
| Supabase migrations | `apps/web/supabase/` | No changes — move with folder |
| Env files | `.env.local` | No changes — no filesystem paths |

---

## Steps

### 1. Rename the folder

```bash
git mv buildersclaw-app apps/web
```

Everything below fixes references that break as a result.

---

### 2. Update import paths in `apps/api/src/`

After the move, `api` and `web` are siblings under `apps/`, so the depth
changes from 3–4 levels to a flat `../../web/src/`.

```bash
find apps/api/src -name "*.ts" -exec sed -i \
  's|"\.\./\.\./\.\./\.\./buildersclaw-app/src/|"../../web/src/|g
   s|"\.\./\.\./\.\./buildersclaw-app/src/|"../../web/src/|g' {} +
```

---

### 3. Update import paths in `apps/worker/src/`

```bash
find apps/worker/src -name "*.ts" -exec sed -i \
  's|"\.\./\.\./\.\./buildersclaw-app/src/|"../../web/src/|g' {} +
```

---

### 4. Update `apps/api/tsconfig.json`

```bash
sed -i \
  's|../../buildersclaw-app/node_modules/@types|../web/node_modules/@types|g
   s|../../buildersclaw-app/src/\*|../web/src/*|g' \
  apps/api/tsconfig.json
```

Result:
```json
"typeRoots": ["../web/node_modules/@types", "node_modules/@types"],
"paths": { "@/*": ["../web/src/*"] }
```

---

### 5. Update `apps/worker/tsconfig.json`

```bash
sed -i 's|../../buildersclaw-app|../web|g' apps/worker/tsconfig.json
```

Result:
```json
{
  "extends": "../web/tsconfig.json",
  "compilerOptions": {
    "baseUrl": "../web",
    "types": ["node"],
    "typeRoots": ["../web/node_modules/@types"]
  },
  "include": ["src/**/*.ts", "../web/src/lib/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

### 6. Update root `.gitignore`

```bash
sed -i \
  's|# Next.js (buildersclaw-app)|# Next.js (apps/web)|
   s|buildersclaw-app/|apps/web/|g' \
  .gitignore
```

---

### 7. Update `apps/web/package.json`

Two changes: rename the package and fix the `worker` script (now a sibling
instead of a nested `apps/worker/`).

```bash
sed -i \
  's|"name": "buildersclaw-app"|"name": "web"|
   s|tsx \.\./apps/worker/src/index\.ts|tsx ../worker/src/index.ts|' \
  apps/web/package.json
```

---

### 8. Update `AGENTS.md`

```bash
sed -i \
  's|buildersclaw-app/|apps/web/|g
   s|buildersclaw-app`|apps/web`|g' \
  AGENTS.md
```

---

### 9. Update `README.md`

```bash
sed -i \
  's|buildersclaw-app/|apps/web/|g
   s|buildersclaw-app`|apps/web`|g
   s|cd buildersclaw-app|cd apps/web|g' \
  README.md
```

---

### 10. Update `apps/web/CLAUDE.md`

```bash
sed -i 's|`buildersclaw-app` contains:|`apps/web` contains:|' apps/web/CLAUDE.md
```

---

## Verification

Run each check in order. A failure means the corresponding step did not apply.

```bash
# 1. No stale references
grep -r "buildersclaw-app" \
  apps/api/src/ apps/worker/src/ \
  apps/api/tsconfig.json apps/worker/tsconfig.json \
  .gitignore apps/web/package.json \
  AGENTS.md README.md apps/web/CLAUDE.md
# Expected: no output

# 2. Typecheck — api
node apps/web/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit

# 3. Typecheck — worker
node apps/web/node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json --noEmit

# 4. Typecheck — web
cd apps/web && npx tsc --noEmit

# 5. Start all three apps
cd apps/web   && pnpm dev                            # Next.js on :3000
cd apps/api   && npx tsx src/server.ts               # Fastify on :3001
cd apps/worker && npx tsx src/index.ts               # background worker

# 6. Smoke test
curl -s http://localhost:3001/health       # {"ok":true,...}
curl -s http://localhost:3001/api/v1       # overview JSON

# 7. Git sanity
git status
# renamed: buildersclaw-app -> apps/web
# modified: apps/api/src/* apps/worker/src/* tsconfigs .gitignore docs AGENTS.md README.md
```

---

## What does NOT change

- `railway.json` and `vercel.json` — no path references, move with the folder
- Supabase migrations in `apps/web/supabase/` — move with the folder
- All env vars — no filesystem paths
- `apps/web/next.config.ts` — no external path references
- Scripts in `apps/web/scripts/` — no external relative paths
