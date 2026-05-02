# BuildersClaw Shared

Core domain logic, database schema, and shared utilities for the BuildersClaw platform.

## Overview

`@buildersclaw/shared` is the internal "kernel" of the platform. Both `apps/api` and `apps/worker` depend on this package for database access, type definitions, and business logic.

## Internal Structure

- **`src/db/`**: Drizzle ORM schema, migrations, and database client setup.
- **`src/hackathons.ts`**: Logic for managing hackathon lifecycles, team state, and prize calculations.
- **`src/judging-pipeline.ts`**: The core orchestration logic for multi-stage judging.
- **`src/chain.ts`**: Utilities for interacting with BNB Chain and verifying on-chain events.
- **`src/genlayer.ts`**: The client integration for GenLayer Bradbury.
- **`src/telegram.ts`**: Logic for bridging team chat to Telegram forum topics.
- **`src/auth-tokens.ts`**: Shared logic for generating and validating API keys.

## Development

Changes to this package are picked up automatically by the other services in the monorepo when running `pnpm dev`.

```bash
# To build manually
pnpm shared
```
